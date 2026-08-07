const MAX_JSON_DEPTH = 32

type JsonObject = Record<string, unknown>

/**
 * Parses provider JSON while preserving every numeric token as its exact wire
 * spelling. Unlike a textual number-rewrite pass, this validates the complete
 * JSON grammar and rejects duplicate object keys.
 */
export function parseLosslessProviderJson(input: string): unknown {
  let index = 0

  function fail(): never {
    throw new SyntaxError('Invalid provider JSON')
  }

  function skipWhitespace(): void {
    while (
      index < input.length &&
      (input[index] === ' ' ||
        input[index] === '\n' ||
        input[index] === '\r' ||
        input[index] === '\t')
    ) {
      index += 1
    }
  }

  function parseString(): string {
    const start = index
    if (input[index] !== '"') fail()
    index += 1
    let escaped = false

    while (index < input.length) {
      const character = input[index]
      index += 1

      if (escaped) {
        escaped = false
        continue
      }
      if (character === '\\') {
        escaped = true
        continue
      }
      if (character === '"') {
        try {
          const value = JSON.parse(input.slice(start, index)) as unknown
          if (typeof value !== 'string') fail()
          return value
        } catch {
          fail()
        }
      }
    }

    fail()
  }

  function parseNumber(): string {
    const start = index

    if (input[index] === '-') index += 1
    if (input[index] === '0') {
      index += 1
      if (/\d/.test(input[index] ?? '')) fail()
    } else if (/[1-9]/.test(input[index] ?? '')) {
      index += 1
      while (/\d/.test(input[index] ?? '')) index += 1
    } else {
      fail()
    }

    if (input[index] === '.') {
      index += 1
      if (!/\d/.test(input[index] ?? '')) fail()
      while (/\d/.test(input[index] ?? '')) index += 1
    }

    if (input[index] === 'e' || input[index] === 'E') {
      index += 1
      if (input[index] === '+' || input[index] === '-') index += 1
      if (!/\d/.test(input[index] ?? '')) fail()
      while (/\d/.test(input[index] ?? '')) index += 1
    }

    return input.slice(start, index)
  }

  function parseArray(depth: number): unknown[] {
    if (depth > MAX_JSON_DEPTH) fail()
    index += 1
    const values: unknown[] = []
    skipWhitespace()
    if (input[index] === ']') {
      index += 1
      return values
    }

    while (index < input.length) {
      values.push(parseValue(depth))
      skipWhitespace()
      if (input[index] === ']') {
        index += 1
        return values
      }
      if (input[index] !== ',') fail()
      index += 1
      skipWhitespace()
    }

    fail()
  }

  function parseObject(depth: number): JsonObject {
    if (depth > MAX_JSON_DEPTH) fail()
    index += 1
    const value: JsonObject = Object.create(null) as JsonObject
    const keys = new Set<string>()
    skipWhitespace()
    if (input[index] === '}') {
      index += 1
      return value
    }

    while (index < input.length) {
      if (input[index] !== '"') fail()
      const key = parseString()
      if (keys.has(key)) fail()
      keys.add(key)
      skipWhitespace()
      if (input[index] !== ':') fail()
      index += 1
      skipWhitespace()
      value[key] = parseValue(depth)
      skipWhitespace()
      if (input[index] === '}') {
        index += 1
        return value
      }
      if (input[index] !== ',') fail()
      index += 1
      skipWhitespace()
    }

    fail()
  }

  function parseValue(depth: number): unknown {
    if (depth > MAX_JSON_DEPTH) fail()
    skipWhitespace()
    const character = input[index]

    if (character === '"') return parseString()
    if (character === '{') return parseObject(depth + 1)
    if (character === '[') return parseArray(depth + 1)
    if (character === '-' || /\d/.test(character ?? '')) return parseNumber()
    if (input.startsWith('true', index)) {
      index += 4
      return true
    }
    if (input.startsWith('false', index)) {
      index += 5
      return false
    }
    if (input.startsWith('null', index)) {
      index += 4
      return null
    }

    fail()
  }

  const value = parseValue(0)
  skipWhitespace()
  if (index !== input.length) fail()
  return value
}
