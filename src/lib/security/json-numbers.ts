/**
 * Parses JSON without ever converting numeric tokens to JavaScript numbers.
 * Provider adapters use this before Zod validation so market values retain
 * their exact decimal spelling from the wire.
 */
export function parseJsonWithNumbersAsStrings(input: string): unknown {
  let output = ''
  let inString = false
  let escaped = false

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]
    if (inString) {
      output += character
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
      continue
    }

    if (character === '"') {
      inString = true
      output += character
      continue
    }

    if (character === '-' || /\d/.test(character)) {
      let end = index + 1
      while (end < input.length && /[0-9eE+.-]/.test(input[end])) end += 1
      output += JSON.stringify(input.slice(index, end))
      index = end - 1
      continue
    }
    output += character
  }
  return JSON.parse(output) as unknown
}
