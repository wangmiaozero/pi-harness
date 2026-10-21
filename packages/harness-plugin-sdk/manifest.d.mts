import type { z } from 'zod'
import type { PluginManifest, PluginPermission, TeamTemplate } from './index'
export const pluginManifestSchema: z.ZodType<PluginManifest>
export const teamTemplateSchema: z.ZodType<TeamTemplate>
export const pluginIdSchema: z.ZodType<string>
export const permissionSchema: z.ZodType<PluginPermission>
export function compatible(manifest: Pick<PluginManifest, 'apiVersion'>): boolean
