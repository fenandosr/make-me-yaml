import crypto from 'node:crypto'

export const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex')

export const toPosix = (p) => p.split('\\').join('/')

/** Convierte un glob (**, *, ?) en RegExp sobre rutas relativas con "/". */
export function globToRegExp(glob) {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++
        if (glob[i + 1] === '/') {
          i++
          re += '(?:.*/)?'
        } else re += '.*'
      } else re += '[^/]*'
    } else if (c === '?') re += '[^/]'
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp('^' + re + '$')
}

export const matchesAny = (relPath, regs) => regs.some((r) => r.test(relPath))

/** Error con código y estado HTTP, para responder de forma uniforme. */
export class HttpError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message)
    this.status = status
    this.code = code
    this.extra = extra
  }
}
