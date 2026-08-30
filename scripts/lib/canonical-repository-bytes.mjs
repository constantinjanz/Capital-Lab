const utf8 = new TextDecoder('utf-8', { fatal: true })

export function canonicalRepositoryTextBytes(bytes) {
  const source = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
  if (source.includes(0)) {
    throw new Error('Repository contract input must be textual')
  }
  return Buffer.from(utf8.decode(source).replace(/\r\n?/gu, '\n'), 'utf8')
}
