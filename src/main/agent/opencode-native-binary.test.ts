// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'

const binary = path.resolve(
  `resources/runtimes/${process.platform}-${process.arch}/pi/${process.platform === 'win32' ? 'pi.exe' : 'pi'}`
)
describe('bundled native Pi OpenCode provider (mock transport, actual executable)', () => {
  it.skipIf(!existsSync(binary))(
    'streams through the native registry, executes a tool and resumes the same model reference',
    async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-opencode-binary-'))
      const extension = path.join(root, 'probe.mjs')
      const record = path.join(root, 'requests.jsonl')
      const providerUrl = pathToFileURL(
        path.resolve('resources/desktop-extension/opencode-provider.mjs')
      ).href
      await fs.writeFile(
        extension,
        `
import fs from 'node:fs/promises'
import { Type } from '@earendil-works/pi-ai'
import { createOpenCodeProvider } from ${JSON.stringify(providerUrl)}
const state = { schemaVersion:2, enabled:true, authMode:'inference', hasCredential:true, refreshedAt:Date.now(), authorizedModels:['big-pickle'], allowedPaidModels:[], models:[{id:'big-pickle', name:'Big Pickle', available:true, api:'openai-completions', cost:{input:0,output:0,cacheRead:0,cacheWrite:0}, price:'free', status:'ready', streaming:'verified', tools:'verified', contextWindow:200000, maxTokens:32000, input:['text'], reasoning:true}] }
const html = '<table><tr><th>Name</th><th>Model ID</th><th>Endpoint</th></tr><tr><td>Big Pickle</td><td>big-pickle</td><td>https://opencode.ai/inference/openai/v1/chat/completions</td></tr></table><table><tr><th>Name</th><th>Input</th><th>Output</th></tr><tr><td>Big Pickle</td><td>Free</td><td>Free</td></tr></table>'
export default async function(pi) {
 const provider = createOpenCodeProvider({resolveKey:async()=> 'native-test-key',state:async()=>state, fetcher:async(url,init)=>{
  if(url.endsWith('/models')) return Response.json({data:[{id:'big-pickle'}]})
  if(url.endsWith('/models/')) return new Response(html)
  const body=JSON.parse(init.body)
  await fs.appendFile(${JSON.stringify(record)}, JSON.stringify({body,headers:init.headers})+'\\n')
  const tool=body.messages.findLast(m=>m.role==='tool')
  const delta=tool ? {content:'native-tool-result:'+tool.content} : {tool_calls:[{index:0,id:'native-call',type:'function',function:{name:'probe_echo',arguments:'{}'}}]}
  const events=[{choices:[{index:0,delta,finish_reason:tool?'stop':'tool_calls'}]},{choices:[],usage:{prompt_tokens:12,completion_tokens:5,total_tokens:17}}]
  return new Response(events.map(e=>'data: '+JSON.stringify(e)+'\\n\\n').join('')+'data: [DONE]\\n\\n',{headers:{'content-type':'text/event-stream'}})
 }})
 await provider.refreshModels()
 pi.registerProvider(provider)
 pi.registerTool({name:'probe_echo',label:'Probe',description:'Return test nonce',parameters:Type.Object({}),execute:async()=>({content:[{type:'text',text:'42'}],details:{}})})
}
`
      )
      let sessionFile: string | undefined
      const execute = async (resume: boolean): Promise<void> => {
        const args = [
          '--mode',
          'rpc',
          '--extension',
          extension,
          '--provider',
          'opencode-free',
          '--model',
          'big-pickle',
          '--tools',
          'probe_echo'
        ]
        if (resume) args.push('--session', sessionFile!)
        const child = spawn(binary, args, {
          cwd: root,
          env: { ...process.env, PI_CODING_AGENT_DIR: root },
          stdio: ['pipe', 'pipe', 'pipe']
        })
        let stdout = '',
          stderr = ''
        child.stderr.on('data', (data) => {
          stderr += data
        })
        try {
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`Native Pi timeout: ${stderr}`)), 15000)
            const fail = (error: Error) => {
              clearTimeout(timer)
              reject(error)
            }
            child.once('error', fail)
            child.once('exit', () => fail(new Error(`Native Pi exited: ${stderr}`)))
            child.stdout.on('data', (data) => {
              stdout += data
              let index: number
              while ((index = stdout.indexOf('\n')) >= 0) {
                const line = stdout.slice(0, index)
                stdout = stdout.slice(index + 1)
                let event
                try {
                  event = JSON.parse(line)
                } catch {
                  continue
                }
                if (event.type === 'response' && event.id === 'state') {
                  try {
                    expect(event.success).toBe(true)
                    expect(event.data.model.provider).toBe('opencode-free')
                    sessionFile = event.data.sessionFile
                    child.stdin.write(
                      JSON.stringify({
                        type: 'prompt',
                        id: 'prompt',
                        message: resume ? 'Continue.' : 'Call probe_echo and return its result.'
                      }) + '\n'
                    )
                  } catch (err) {
                    fail(err as Error)
                  }
                }
                if (event.type === 'agent_end') {
                  try {
                    const last = event.messages
                      .filter((m: { role: string }) => m.role === 'assistant')
                      .at(-1)
                    expect(last.stopReason).toBe('stop')
                    expect(last.content).toContainEqual({
                      type: 'text',
                      text: 'native-tool-result:42'
                    })
                    expect(last.provider).toBe('opencode-free')
                    clearTimeout(timer)
                    resolve()
                  } catch (err) {
                    fail(err as Error)
                  }
                }
              }
            })
            child.stdin.write(JSON.stringify({ type: 'get_state', id: 'state' }) + '\n')
          })
        } finally {
          if (child.exitCode === null && child.signalCode === null) {
            await new Promise<void>((resolve) => {
              child.once('close', () => resolve())
              child.kill()
            })
          }
        }
      }
      try {
        await execute(false)
        expect(sessionFile).toBeTruthy()
        await execute(true)
        const requests = (await fs.readFile(record, 'utf8'))
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line))
        expect(requests).toHaveLength(3)
        for (const request of requests) {
          expect(request.headers).toMatchObject({
            'content-type': 'application/json',
            authorization: 'Bearer native-test-key',
            'user-agent': 'Pi-Harness'
          })
        }
        expect(requests[1].body.messages).toContainEqual({
          role: 'tool',
          tool_call_id: 'native-call',
          content: '42'
        })
        expect(requests[2].body.messages.some((m: { role: string }) => m.role === 'tool')).toBe(
          true
        )
      } finally {
        await fs.rm(root, { recursive: true, force: true })
      }
    },
    40000
  )
})
