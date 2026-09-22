/**
 * Phase 5 domain RPC: providers / models / config / skills / capabilities /
 * backup / settings / diagnostics / logs / pi environment.
 *
 * Mirrors Electron `src/main/ipc/register.ts` so the Tauri bridge stays a
 * thin forwarder (`runtime_request`). Native clipboard / dialog / open-URL
 * stay in Rust; those methods return the payload the host needs.
 */

import { requireString, RuntimeError } from '../pi/errors.js'
import type { RuntimeServices } from '../services.js'
import type { RpcHandler, RpcParams } from './dispatch.js'
import { ValidationError } from '../desktop/services/errors.js'
import { logFilePath } from '../desktop/services/app-paths.js'
import { readTextFile } from '../desktop/services/storage.js'
import {
  builtinSkillMutationTargetSchema,
  optionalProjectRootSchema,
  piPackageRegistryDetailSchema,
  piPackageRegistrySearchSchema,
  piPackageTargetSchema,
  piPackageTargetsSchema,
  providerModelDiscoverySchema,
  testConnectionSchema,
  skillFormSchema,
  skillImportSchema,
  providerKeySchema,
  backupIdSchema,
  pathSegmentSchema
} from '../vendor/shared/schemas/domain.js'
import {
  appSettingsPatchSchema,
  pickKnownAppSettings,
  backupReasonSchema,
  backupRetentionSchema,
  configContentSchema,
  configFileSchema,
  overwriteOptionsSchema,
  uiStateSchema,
  modelCompositeIdSchema
} from '../vendor/shared/schemas/ipc.js'
import { capabilityMutationSchema, capabilityToggleSchema } from '../vendor/shared/capabilities/schema.js'
import { findTrustedCapability } from '../vendor/shared/capabilities/catalog.js'
import { DEFAULT_MASCOT_STYLE, isMascotUnlockAnswer } from '../vendor/shared/constants/mascot.js'
import { normalizeNavOrder } from '../vendor/shared/constants/navigation.js'
import { normalizeAppTheme } from '../vendor/shared/constants/theme.js'
import { NODE_DOWNLOAD_URL, PI_INSTALL_COMMAND } from '../vendor/shared/constants/pi-install.js'
import { SecurityError } from '../desktop/services/errors.js'
import type { ZodType } from 'zod'

type MethodMap = Record<string, RpcHandler>

function parseInput<T>(schema: ZodType<T>, value: unknown, message: string): T {
  const result = schema.safeParse(value)
  if (!result.success) throw new ValidationError(message, { issues: result.error.issues })
  return result.data
}

function optionalOverwrite(params: RpcParams): { overwrite?: boolean } | undefined {
  if (params['options'] === undefined && params['overwrite'] === undefined) return undefined
  const options = params['options'] ?? { overwrite: params['overwrite'] }
  return parseInput(overwriteOptionsSchema, options, 'Invalid write options')
}

function optionalBoolean(params: RpcParams, key: string): boolean | undefined {
  const value = params[key]
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') {
    throw new RuntimeError('INVALID_INPUT', `Parameter "${key}" must be a boolean`)
  }
  return value
}

export function registerDesktopMethods(methods: MethodMap, services: RuntimeServices): void {
  const desktop = services.desktop
  if (!desktop) return
  const {
    settingsStore,
    uiStateStore,
    backup,
    config,
    providers,
    models,
    skills,
    capabilities,
    diagnostics,
    environment,
    piProcess
  } = desktop

  const notifyConfig = async <T>(operation: () => Promise<T>): Promise<T> => {
    const result = await operation()
    return result
  }

  // ---- pi ----
  methods['pi.detect'] = async () => environment.detect()
  methods['pi.getVersion'] = async () => {
    const settings = settingsStore.peek()
    const cli = await piProcess.resolveCliPath(settings.manualCliPath)
    const version = cli ? await piProcess.version() : null
    return { cli, version }
  }
  methods['pi.runHelp'] = async () => piProcess.help()
  methods['pi.checkLatest'] = async () => environment.checkLatest()
  methods['pi.install'] = async () => desktop.runMutation('env', () => environment.installPi())
  methods['pi.bootstrap'] = async () => desktop.runMutation('env', () => environment.bootstrap())
  methods['pi.installNode'] = async () => desktop.runMutation('env', () => environment.installNode())
  methods['pi.reinstall'] = async () => desktop.runMutation('env', () => environment.reinstallPi())
  methods['pi.getInstallTask'] = async () => environment.getTask()
  methods['pi.cancelInstall'] = async () => environment.cancel()
  methods['pi.update'] = async (params) =>
    desktop.runMutation('env', () => environment.updatePi(optionalBoolean(params, 'force') === true))
  methods['pi.copyInstallCommand'] = async () => PI_INSTALL_COMMAND
  methods['pi.openNodeDownload'] = async () => NODE_DOWNLOAD_URL

  // ---- providers ----
  methods['providers.list'] = async () => providers.list()
  methods['providers.get'] = async (params) =>
    providers.get(parseInput(providerKeySchema, params['key'], 'Invalid provider key'))
  methods['providers.create'] = async (params) =>
    providers.create(params['form'], optionalOverwrite(params))
  methods['providers.update'] = async (params) =>
    providers.update(
      parseInput(providerKeySchema, params['key'], 'Invalid provider key'),
      params['form'],
      optionalOverwrite(params)
    )
  methods['providers.delete'] = async (params) => {
    await providers.delete(
      parseInput(providerKeySchema, params['key'], 'Invalid provider key'),
      optionalOverwrite(params)
    )
    return null
  }
  methods['providers.duplicate'] = async (params) =>
    providers.duplicate(
      parseInput(providerKeySchema, params['key'], 'Invalid provider key'),
      optionalOverwrite(params)
    )
  methods['providers.setEnabled'] = async (params) => {
    const enabled = optionalBoolean(params, 'enabled')
    if (enabled === undefined) throw new ValidationError('Invalid enabled state')
    return providers.setEnabled(
      parseInput(providerKeySchema, params['key'], 'Invalid provider key'),
      enabled
    )
  }
  methods['providers.testConnection'] = async (params) => {
    const parsed = testConnectionSchema.safeParse(params['input'] ?? params)
    if (!parsed.success) throw new ValidationError('Invalid test input', { issues: parsed.error.issues })
    return providers.testConnection(parsed.data)
  }
  methods['providers.discoverModels'] = async (params) =>
    providers.discoverModels(
      parseInput(
        providerModelDiscoverySchema,
        params['input'] ?? params,
        'Invalid model discovery input'
      )
    )

  // ---- models ----
  methods['models.list'] = async () => models.list()
  methods['models.create'] = async (params) => models.create(params['form'], optionalOverwrite(params))
  methods['models.update'] = async (params) =>
    models.update(
      parseInput(modelCompositeIdSchema, params['id'], 'Invalid model id'),
      params['form'],
      optionalOverwrite(params)
    )
  methods['models.delete'] = async (params) => {
    await models.delete(
      parseInput(modelCompositeIdSchema, params['id'], 'Invalid model id'),
      optionalOverwrite(params)
    )
    return null
  }
  methods['models.setActive'] = async (params) =>
    models.setActive(params['input'] ?? params, optionalOverwrite(params))
  methods['models.getActive'] = async () => models.getActive()

  // ---- config ----
  methods['config.read'] = async () => config.readRaw('models')
  methods['config.readRaw'] = async (params) =>
    config.readRaw(parseInput(configFileSchema, params['file'], 'Invalid config file'))
  methods['config.writeRaw'] = async (params) => {
    const configFile = parseInput(configFileSchema, params['file'], 'Invalid config file')
    const configContent = parseInput(configContentSchema, params['content'], 'Invalid config content')
    const writeOptions = optionalOverwrite(params)
    if (configFile === 'models') await config.writeModelsRaw(configContent, writeOptions)
    else await config.writeSettingsRaw(configContent, { overwrite: writeOptions?.overwrite })
    return null
  }
  methods['config.readSettings'] = async () => config.readRaw('settings')
  methods['config.reload'] = async () => {
    await config.read()
    return config.getStatus()
  }
  methods['config.getStatus'] = async () => config.getStatus()
  methods['config.conflictSnapshot'] = async (params) =>
    config.getConflictSnapshot(parseInput(configFileSchema, params['file'], 'Invalid config file'))

  // ---- skills / packages ----
  const parseProjectRoot = (params: RpcParams): string | null | undefined => {
    const parsed = optionalProjectRootSchema.safeParse(params['projectRoot'])
    if (!parsed.success) throw new ValidationError('Invalid project root')
    return parsed.data
  }
  const parsePackageTarget = (value: unknown) => {
    const parsed = piPackageTargetSchema.safeParse(value)
    if (!parsed.success) {
      throw new ValidationError('Invalid package target', { issues: parsed.error.issues })
    }
    return parsed.data
  }
  const mutatePackages = <T>(operation: () => Promise<T>): Promise<T> =>
    desktop.runMutation('package', () => notifyConfig(operation))

  methods['skills.list'] = async (params) => skills.list(parseProjectRoot(params))
  methods['skills.packages'] = async (params) => skills.listPackages(parseProjectRoot(params))
  methods['skills.market'] = async (params) => skills.listMarket(parseProjectRoot(params))
  methods['skills.installBuiltinSkills'] = async (params) =>
    mutatePackages(() =>
      skills.installBuiltinSkills(
        parseInput(builtinSkillMutationTargetSchema, params['target'] ?? params, 'Invalid built-in Skill target')
      )
    )
  methods['skills.updateBuiltinSkills'] = async (params) =>
    mutatePackages(() =>
      skills.updateBuiltinSkills(
        parseInput(builtinSkillMutationTargetSchema, params['target'] ?? params, 'Invalid built-in Skill target')
      )
    )
  methods['skills.uninstallBuiltinSkills'] = async (params) =>
    mutatePackages(() =>
      skills.uninstallBuiltinSkills(
        parseInput(builtinSkillMutationTargetSchema, params['target'] ?? params, 'Invalid built-in Skill target')
      )
    )
  methods['skills.installPackages'] = async (params) => {
    const parsed = piPackageTargetsSchema.safeParse(params['targets'] ?? params['target'])
    if (!parsed.success) {
      throw new ValidationError('Invalid package targets', { issues: parsed.error.issues })
    }
    return mutatePackages(() => skills.installPackages(parsed.data))
  }
  methods['skills.searchRegistry'] = async (params) => {
    const parsed = piPackageRegistrySearchSchema.safeParse(params['input'] ?? params)
    if (!parsed.success) {
      throw new ValidationError('Invalid package Registry search', { issues: parsed.error.issues })
    }
    return skills.searchRegistry(parsed.data)
  }
  methods['skills.getRegistryPackageDetail'] = async (params) => {
    const parsed = piPackageRegistryDetailSchema.safeParse({
      name: params['name'],
      refresh: params['refresh']
    })
    if (!parsed.success) {
      throw new ValidationError('Invalid package Registry detail request', {
        issues: parsed.error.issues
      })
    }
    return skills.getRegistryPackageDetail(parsed.data.name, parsed.data.refresh)
  }
  methods['skills.checkPackageUpdates'] = async (params) =>
    skills.checkPackageUpdates(parseProjectRoot(params))
  methods['skills.updatePackage'] = async (params) =>
    mutatePackages(() => skills.updatePackage(parsePackageTarget(params['target'] ?? params)))
  methods['skills.updateAllPackages'] = async (params) =>
    mutatePackages(() => skills.updateAllPackages(parseProjectRoot(params)))
  methods['skills.repairPackage'] = async (params) =>
    mutatePackages(() => skills.repairPackage(parsePackageTarget(params['target'] ?? params)))
  methods['skills.registerPackage'] = async (params) =>
    mutatePackages(() => skills.registerPackage(parsePackageTarget(params['target'] ?? params)))
  methods['skills.removePackages'] = async (params) => {
    const parsed = piPackageTargetsSchema.safeParse(params['targets'] ?? params['target'])
    if (!parsed.success) {
      throw new ValidationError('Invalid package targets', { issues: parsed.error.issues })
    }
    return mutatePackages(() => skills.removePackages(parsed.data))
  }
  methods['skills.removePackage'] = async (params) =>
    mutatePackages(() => skills.removePackage(parsePackageTarget(params['target'] ?? params)))
  methods['skills.deleteOrphanPackage'] = async (params) =>
    mutatePackages(() => skills.deleteOrphanPackage(parsePackageTarget(params['target'] ?? params)))
  methods['skills.cleanupPlan'] = async (params) => skills.cleanupPlan(parseProjectRoot(params))
  methods['skills.cleanupThirdParty'] = async (params) =>
    mutatePackages(() => skills.cleanupThirdParty(parseProjectRoot(params)))
  methods['skills.repairPermissions'] = async (params) =>
    mutatePackages(() => skills.repairPermissions(parseProjectRoot(params)))
  methods['skills.read'] = async (params) =>
    skills.read(parseInput(pathSegmentSchema, params['path'], 'Invalid skill path'))
  methods['skills.create'] = async (params) => {
    const parsed = skillFormSchema.safeParse(params['form'] ?? params)
    if (!parsed.success) throw new ValidationError('Invalid skill form', { issues: parsed.error.issues })
    return skills.create(parsed.data)
  }
  methods['skills.update'] = async (params) => {
    const parsed = skillFormSchema.safeParse(params['form'] ?? params)
    if (!parsed.success) throw new ValidationError('Invalid skill form', { issues: parsed.error.issues })
    return skills.update(parsed.data)
  }
  methods['skills.import'] = async (params) => {
    const parsed = skillImportSchema.safeParse(params['input'] ?? params)
    if (!parsed.success) throw new ValidationError('Invalid import input', { issues: parsed.error.issues })
    return skills.import(parsed.data)
  }
  methods['skills.validate'] = async (params) => {
    const parsed = skillFormSchema.safeParse(params['form'] ?? params)
    if (!parsed.success) {
      return {
        valid: false,
        issues: parsed.error.issues.map((issue) => ({ level: 'error' as const, message: issue.message }))
      }
    }
    return skills.validate(parsed.data)
  }
  methods['skills.delete'] = async (params) => {
    await skills.delete(parseInput(pathSegmentSchema, params['path'], 'Invalid skill path'))
    return null
  }
  methods['skills.refresh'] = async (params) => skills.list(parseProjectRoot(params))

  // ---- capabilities ----
  methods['capabilities.list'] = async () => capabilities.list()
  methods['capabilities.homepageUrl'] = async (params) => {
    const parsed = capabilityMutationSchema.safeParse({ skillId: requireString(params, 'skillId') })
    if (!parsed.success) {
      throw new ValidationError('Invalid capability homepage input', { issues: parsed.error.issues })
    }
    const definition = findTrustedCapability(parsed.data.skillId)
    if (!definition?.sourceUrl?.startsWith('https://github.com/')) {
      throw new SecurityError('Capability has no trusted GitHub homepage')
    }
    return definition.sourceUrl
  }
  methods['capabilities.installSkill'] = async (params) => {
    const parsed = capabilityMutationSchema.safeParse({ skillId: requireString(params, 'skillId') })
    if (!parsed.success) {
      throw new ValidationError('Invalid capability install input', { issues: parsed.error.issues })
    }
    return mutatePackages(() => capabilities.install(parsed.data.skillId))
  }
  methods['capabilities.updateSkill'] = async (params) => {
    const parsed = capabilityMutationSchema.safeParse({ skillId: requireString(params, 'skillId') })
    if (!parsed.success) {
      throw new ValidationError('Invalid capability update input', { issues: parsed.error.issues })
    }
    return mutatePackages(() => capabilities.update(parsed.data.skillId))
  }
  methods['capabilities.uninstallSkill'] = async (params) => {
    const parsed = capabilityMutationSchema.safeParse({ skillId: requireString(params, 'skillId') })
    if (!parsed.success) {
      throw new ValidationError('Invalid capability uninstall input', { issues: parsed.error.issues })
    }
    return mutatePackages(() => capabilities.uninstall(parsed.data.skillId))
  }
  methods['capabilities.setSkillEnabled'] = async (params) => {
    const parsed = capabilityToggleSchema.safeParse({
      skillId: requireString(params, 'skillId'),
      enabled: optionalBoolean(params, 'enabled')
    })
    if (!parsed.success) {
      throw new ValidationError('Invalid capability enable input', { issues: parsed.error.issues })
    }
    return capabilities.setEnabled(parsed.data.skillId, parsed.data.enabled)
  }

  // ---- backup ----
  methods['backup.list'] = async () => backup.list()
  methods['backup.create'] = async (params) =>
    backup.create(parseInput(backupReasonSchema, params['reason'], 'Invalid backup reason') ?? 'manual')
  methods['backup.restore'] = async (params) => {
    await backup.restore(parseInput(backupIdSchema, params['id'], 'Invalid backup id'))
    return null
  }
  methods['backup.delete'] = async (params) => {
    await backup.delete(parseInput(backupIdSchema, params['id'], 'Invalid backup id'))
    return null
  }
  methods['backup.pruneToRetention'] = async (params) =>
    backup.pruneToRetention(
      parseInput(backupRetentionSchema, params['retention'], 'Invalid backup retention')
    )
  methods['backup.openFolder'] = async () => backup.openFolder()

  // ---- settings ----
  methods['settings.get'] = async () => {
    const settings = pickKnownAppSettings(await settingsStore.read())
    settings.theme = normalizeAppTheme(settings.theme)
    settings.navOrder = normalizeNavOrder(settings.navOrder)
    return settings
  }
  methods['settings.set'] = async (params) => {
    const parsedPatch = parseInput(appSettingsPatchSchema, params['patch'] ?? params, 'Invalid settings')
    const current = pickKnownAppSettings(await settingsStore.read())
    current.theme = normalizeAppTheme(current.theme)
    current.navOrder = normalizeNavOrder(current.navOrder)
    const nextPatch = { ...parsedPatch }
    if (!current.mascotUnlocked) nextPatch.mascotUnlocked = false
    const mascotUnlocked = current.mascotUnlocked && nextPatch.mascotUnlocked !== false
    if (!mascotUnlocked) {
      nextPatch.mascotUnlocked = false
      nextPatch.mascotStyle = DEFAULT_MASCOT_STYLE
    }
    const settings = { ...current, ...nextPatch }
    settings.navOrder = normalizeNavOrder(settings.navOrder)
    await settingsStore.write(settings)
    return settings
  }
  methods['settings.unlockMascot'] = async (params) => {
    const answer = params['answer']
    if (typeof answer !== 'string' || answer.length > 64 || !isMascotUnlockAnswer(answer)) {
      return false
    }
    await settingsStore.update({ mascotUnlocked: true })
    return true
  }
  methods['settings.getUiState'] = async () => uiStateStore.read()
  methods['settings.setUiState'] = async (params) => {
    await uiStateStore.write(parseInput(uiStateSchema, params['state'] ?? params, 'Invalid UI state'))
    return null
  }

  // ---- diagnostics / logs ----
  methods['diagnostics.get'] = async () => diagnostics.get()
  methods['diagnostics.copyText'] = async () => diagnostics.copyText()
  methods['diagnostics.export'] = async () => diagnostics.export()
  methods['logs.read'] = async () => (await readTextFile(logFilePath())) ?? ''
  methods['logs.path'] = async () => logFilePath()
}
