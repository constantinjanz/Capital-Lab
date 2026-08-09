import { checkRequiredOpenAIModelAccess } from '../src/providers/openai/gateway'

const result = await checkRequiredOpenAIModelAccess(process.env.OPENAI_API_KEY)
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
process.exitCode = result.status === 'ok' ? 0 : 1
