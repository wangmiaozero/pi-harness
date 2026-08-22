export const PI_NPM_PACKAGE = '@earendil-works/pi-coding-agent'

export const PI_INSTALL_ARGS = ['install', '-g', '--ignore-scripts', PI_NPM_PACKAGE] as const

export const PI_INSTALL_COMMAND = `npm ${PI_INSTALL_ARGS.join(' ')}`

export const NODE_DOWNLOAD_URL = 'https://nodejs.org/en/download'
