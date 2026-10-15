// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { extractGraph } from './graph'
import { hash, type Scan } from './scanner'
import { architectureGraphSchema } from '@shared/intelligence/schema'
import { retrieveArchitecture } from './context'

function graphFixture(input: Record<string, string>) {
  const extensions: Record<string, string> = {
    py: 'Python',
    go: 'Go',
    java: 'Java',
    rs: 'Rust',
    ts: 'TypeScript'
  }
  const files = Object.entries(input).map(([path, text]) => ({
    path,
    text,
    hash: hash(text),
    lines: text.split('\n').length
  }))
  const scan: Scan = {
    files,
    fingerprint: hash(JSON.stringify(files)),
    languages: [
      ...new Set(files.flatMap((file) => extensions[file.path.split('.').at(-1)!] ?? []))
    ],
    frameworks: [],
    packageManagers: [],
    coverage: { files: files.length, bytes: 0, skipped: 0, partial: false }
  }
  return extractGraph('/fixture/project', scan)
}
const relationships = (graph: ReturnType<typeof graphFixture>) =>
  graph.edges.map((edge) => ({
    from: graph.nodes.find((node) => node.id === edge.source)!.name,
    to: graph.nodes.find((node) => node.id === edge.target)!.name,
    line: edge.sourceReferences[0].startLine,
    relation: edge.relation
  }))
const pom = (name: string, dependencies = '') =>
  `<project><groupId>local</groupId><artifactId>${name}</artifactId><dependencies>${dependencies}</dependencies></project>`

describe('conservative multi-language architecture declarations', () => {
  it('resolves configured Python package roots and relative imports while omitting strings and dynamic names', () => {
    const graph = graphFixture({
      'pyproject.toml': '[project]\nname="example"\n[tool.setuptools.package-dir]\n""="src"',
      'src/pkg/__init__.py': '',
      'src/pkg/util.py': 'def run(): pass',
      'src/pkg/main.py':
        '# import imaginary\n"""from fake import x"""\nfrom .util import run\nimport pkg.util as helper\nfrom external import missing\n__import__(name)',
      'imaginary.py': '',
      'fake.py': ''
    })
    expect(relationships(graph)).toEqual([
      { from: 'src/pkg/main.py', to: 'src/pkg/util.py', line: 3, relation: 'imports' }
    ])
    expect(graph.analysis?.diagnostics).toContainEqual(
      expect.objectContaining({ path: 'src/pkg/main.py', line: 5, specifier: 'external' })
    )
    expect(graph.analysis?.languages[0]).toMatchObject({
      language: 'Python',
      imports: 'static-declarations',
      calls: 'unknown'
    })
    expect(graph.project.packages[0].manifest).toBe('pyproject.toml')
  })
  it('models Go imports as package dependencies and requires an explicit multi-module workspace', () => {
    const graph = graphFixture({
      'go.work': 'go 1.24\nuse (\n ./app\n "./lib"\n)\n',
      'app/go.mod': 'module example/app\ngo 1.24',
      'lib/go.mod': 'module example/lib\ngo 1.24',
      'other/go.mod': 'module example/other',
      'app/main.go':
        'package main\nimport (\n "example/lib/service"\n "example/other"\n)\nfunc main() {}',
      'lib/service/first.go': 'package service\nfunc First() {}',
      'lib/service/second.go': 'package service\nfunc Second() {}',
      'other/main.go': 'package other'
    })
    expect(relationships(graph)).toContainEqual({
      from: 'app/main.go',
      to: 'lib/service (Go package)',
      line: 3,
      relation: 'imports-package'
    })
    expect(graph.edges).toHaveLength(1)
    expect(graph.edges[0].sourceReferences.map((reference) => reference.path)).toContain('go.work')
    expect(graph.analysis?.diagnostics).toContainEqual(
      expect.objectContaining({ specifier: 'example/other' })
    )
    expect(graph.nodes.find((node) => node.type === 'package')!.sourceReferences[0].path).toBe(
      'lib/service/first.go'
    )
  })
  it('resolves Java classes only in a declared local classpath, keeping wildcard and ambiguous imports unknown', () => {
    const graph = graphFixture({
      'pom.xml':
        '<project><groupId>local</groupId><artifactId>root</artifactId><modules><module>app</module><module>lib</module></modules></project>',
      'app/pom.xml': pom(
        'app',
        '<dependency><groupId>local</groupId><artifactId>lib</artifactId></dependency>'
      ),
      'lib/pom.xml': pom('lib'),
      'unlinked/pom.xml': pom('unlinked'),
      'app/src/main/java/app/Main.java':
        'package app;\nimport lib.Service;\nimport lib.*;\nimport unlinked.Other;\npublic class Main { Object x; void run() { x.toString(); } }',
      'lib/src/main/java/lib/Service.java': 'package lib; public class Service {}',
      'lib/src/test/java/lib/Service.java': 'package lib; public class Service {}',
      'unlinked/src/main/java/unlinked/Other.java': 'package unlinked; public class Other {}'
    })
    expect(relationships(graph)).toEqual([
      {
        from: 'app/src/main/java/app/Main.java',
        to: 'lib/src/main/java/lib/Service.java',
        line: 2,
        relation: 'imports'
      }
    ])
    expect(graph.analysis?.languages.find((entry) => entry.language === 'Java')?.calls).toBe(
      'unknown'
    )
    expect(graph.analysis?.diagnostics.map((entry) => entry.specifier)).toEqual(
      expect.arrayContaining(['lib.*', 'unlinked.Other'])
    )
  })
  it('reads literal Gradle project dependencies without evaluating scripts', () => {
    const graph = graphFixture({
      'settings.gradle.kts': 'include(":app", ":lib")',
      'app/build.gradle.kts': 'plugins { java }\ndependencies { implementation(project(":lib")) }',
      'lib/build.gradle.kts': 'plugins { java }',
      'app/src/main/java/app/Main.java': 'package app; import lib.Service; class Main {}',
      'lib/src/main/java/lib/Service.java': 'package lib; class Service {}'
    })
    expect(relationships(graph)).toEqual([
      {
        from: 'app/src/main/java/app/Main.java',
        to: 'lib/src/main/java/lib/Service.java',
        line: 1,
        relation: 'imports'
      }
    ])
    expect(graph.analysis?.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'GRADLE_DYNAMIC_CONFIGURATION_UNKNOWN' })
    )
    expect(graph.project.packages).toHaveLength(2)
  })
  it('resolves explicit Rust modules and path crates without inventing trait or function calls', () => {
    const graph = graphFixture({
      'Cargo.toml':
        '[workspace]\nmembers=["app", "lib"]\n[workspace.dependencies]\nhelper={path="lib"}',
      'app/Cargo.toml':
        '[package]\nname="app"\nversion="1.0.0"\n[dependencies]\nhelper={workspace=true}',
      'lib/Cargo.toml': '[package]\nname="helper"\nversion="1.0.0"',
      'app/src/lib.rs':
        'mod service;\nuse crate::service::run;\nuse helper::run;\nconst TEXT: &str = r###"mod fake; use unknown::x;"###;\nfn invoke(x: &dyn Service) { x.run(); }',
      'app/src/service.rs': 'pub fn run() {}',
      'app/src/fake.rs': '',
      'lib/src/lib.rs': 'pub fn run() {}'
    })
    expect(relationships(graph)).toEqual(
      expect.arrayContaining([
        { from: 'app/src/lib.rs', to: 'app/src/service.rs', line: 1, relation: 'declares-module' },
        { from: 'app/src/lib.rs', to: 'lib/Cargo.toml', line: 3, relation: 'depends-on' }
      ])
    )
    expect(graph.edges.every((edge) => !/call/.test(edge.relation))).toBe(true)
    expect(relationships(graph).some((edge) => edge.to.endsWith('fake.rs'))).toBe(false)
    expect(graph.analysis?.languages.find((entry) => entry.language === 'Rust')?.calls).toBe(
      'unknown'
    )
  })
  it('isolates malformed declarations, ambiguous Python modules and attributed Rust module paths', () => {
    const graph = graphFixture({
      'main.py': 'import duplicate\nimport broken',
      'duplicate.py': '',
      'duplicate/__init__.py': '',
      'broken.py': '"""unclosed',
      'Cargo.toml': '[package]\nname="test"\nversion="0.1.0"',
      'src/lib.rs': '#[path="alternate.rs"]\nmod module;',
      'src/module.rs': '',
      'src/alternate.rs': ''
    })
    expect(relationships(graph).some((edge) => edge.to.includes('duplicate'))).toBe(false)
    expect(relationships(graph).some((edge) => edge.from === 'src/lib.rs')).toBe(false)
    expect(graph.analysis?.diagnostics).toContainEqual(
      expect.objectContaining({ path: 'broken.py', code: 'UNSUPPORTED_OR_MALFORMED_SOURCE' })
    )
  })
  it('does not mistake a nested module named lib.rs for a Rust crate root', () => {
    const graph = graphFixture({
      'Cargo.toml': '[package]\nname="example"\nversion="0.1.0"',
      'src/lib.rs': 'mod outer;',
      'src/outer.rs': 'mod lib;',
      'src/outer/lib.rs': 'mod child;',
      'src/outer/lib/child.rs': 'pub fn right() {}',
      'src/outer/child.rs': 'pub fn wrong() {}'
    })
    expect(relationships(graph)).toContainEqual({
      from: 'src/outer/lib.rs',
      to: 'src/outer/lib/child.rs',
      line: 1,
      relation: 'declares-module'
    })
    expect(relationships(graph).some((edge) => edge.to === 'src/outer/child.rs')).toBe(false)
  })
  it('does not turn Gradle project lookups or test-only dependencies into a main classpath', () => {
    const graph = graphFixture({
      'settings.gradle.kts': 'include(":app", ":lib")',
      'app/build.gradle.kts':
        'println(project(":lib").name)\ndependencies { testImplementation(project(":lib")) }',
      'lib/build.gradle.kts': 'plugins { java }',
      'app/src/main/java/app/Main.java': 'package app; import lib.Service; class Main {}',
      'lib/src/main/java/lib/Service.java': 'package lib; class Service {}'
    })
    expect(graph.edges).toHaveLength(0)
  })
  it('uses declared Rust binary roots and leaves orphan source dependencies unknown', () => {
    const graph = graphFixture({
      'Cargo.toml':
        '[package]\nname="example"\nversion="0.1.0"\n[[bin]]\nname="custom"\npath="tools/driver.rs"',
      'tools/driver.rs': 'mod child;',
      'tools/child.rs': 'fn child() {}',
      'tools/driver/child.rs': 'fn wrong() {}',
      'src/orphan.rs': 'mod invented;',
      'src/orphan/invented.rs': 'fn unused() {}'
    })
    expect(relationships(graph)).toEqual([
      { from: 'tools/driver.rs', to: 'tools/child.rs', line: 1, relation: 'declares-module' }
    ])
    expect(graph.analysis?.diagnostics).toContainEqual(
      expect.objectContaining({ path: 'src/orphan.rs', code: 'RUST_CRATE_ROOT_UNKNOWN' })
    )
  })
  it('bounds diagnostics and keeps legacy snapshots compatible without fabricating coverage', () => {
    const graph = graphFixture({
      'main.py': Array.from({ length: 400 }, (_, index) => `import unavailable_${index}`).join('\n')
    })
    expect(graph.analysis?.diagnostics).toHaveLength(200)
    expect(graph.analysis?.diagnosticsTruncated).toBe(true)
    expect(graph.analysis?.languages[0].unresolved).toBe(400)
    const { analysis: _analysis, ...legacy } = graph
    expect(architectureGraphSchema.parse(legacy).analysis).toBeUndefined()
    expect(retrieveArchitecture(graph, 'fresh', 'get_project_architecture', {})).toMatchObject({
      available: true
    })
  })
})
