// B28.250 — a provider's refusal never shows the tenant the key Lens sent or where it sent it: on Group, which includes
// own provider keys, the workspace saves a placeholder key and asks two questions nobody has asked, one buffered and one
// streamed (Lens's two copies of the proxy), so neither its cache nor the pool can answer and Lens must send each on that
// key. The provider refuses the placeholder, and what Lens answers must carry neither the key nor the provider's address.
// The key is deleted after. B28.250's other half, a pooled answer taking as long as a live one and a workspace probing the
// pool losing its saving headers, is the old gateway's pool, held until the partner is live (Nick, 11 Nov), and its probe
// limit is off unless the operator sets LENS_POOL_PROBE_LIMIT; internal/proxy's b28250 tests prove both.

import { fail } from './bank.ts'
import { RUN_SALT } from './oracles.ts'
import { CannotTest, type Scenario } from './scenarios.ts'

/** Where Lens sends a provider call: none of these addresses reaches the tenant in a refusal. */
export const UPSTREAM_HOSTS = /api\.anthropic\.com|api\.openai\.com|generativelanguage\.googleapis\.com|api\.groq\.com|api\.x\.ai|api\.mistral\.ai|bedrock[\w.-]*\.amazonaws\.com/i

const MAX_TOKENS = 16

export function providerKeyHidden(): Scenario {
  return {
    id: 'provider-key-hidden',
    owner: 'talyvor-lens',
    items: ['B28.250'],
    plan: 'business_group',
    own: true,
    feature: 'Lens settings',
    title: "a call on the workspace's own provider key that the provider refuses, buffered or streamed, shows the tenant neither the key nor the provider's address",
    run: async (ctx) => {
      const { env, app } = ctx
      const provider = env.judgeProvider
      const tail = `${RUN_SALT}-${Date.now().toString(36)}`
      const key = `sk-talyvor-e2e-placeholder-${tail}`
      const saved = await env.lens.putProviderKey(app.user, provider, key)
      ctx.evidence.push({ note: `save an own ${provider} key ending ${key.slice(-4)}: ${saved.status}${saved.ok ? '' : ` ${saved.error}`}` })
      if (!saved.ok && saved.status === 404) throw new CannotTest('Lens holds no provider keys on this deployment (LENS_PROVIDER_SECRET_KEK unset), so no call can be made on one')
      if (!saved.ok) return fail(`on Group, saving an own provider key was refused: ${saved.status} ${saved.error}`)
      const wrong: string[] = []
      try {
        for (const stream of [false, true]) {
          const how = stream ? 'streamed' : 'buffered'
          const nonce = `${Date.now().toString(36)}${stream ? 's' : 'b'}`
          const asked = await env.lens.askRaw(app.user, provider, env.judgeModel, `What is 731 + 268? Reply with the number only. (${nonce})`, MAX_TOKENS, stream)
          // What Lens said, with the key cut out, so the evidence never holds it either.
          ctx.evidence.push({ note: `${how}: ${asked.status}${asked.ownKey ? ' on the own key' : ''} ${asked.text.split(key).join('<the key>').split(tail).join('<the key>').slice(0, 300)}` })
          if (!asked.ownKey) wrong.push(`the ${how} call was not sent on the workspace's own key (no X-Talyvor-BYOK: own-key); Lens answered ${asked.status}`)
          else if (asked.status >= 200 && asked.status < 300) wrong.push(`the ${how} call on a placeholder key was answered ${asked.status}, so no refusal was seen`)
          if (asked.text.includes(tail)) wrong.push(`the ${how} refusal shows the tenant the provider key Lens sent`)
          const host = UPSTREAM_HOSTS.exec(asked.text)
          if (host !== null) wrong.push(`the ${how} refusal shows the tenant the provider's address ${host[0]}`)
        }
      } finally {
        await env.lens.deleteProviderKey(app.user, provider)
      }
      return wrong.length === 0
        ? { pass: true, detail: `the provider refused the placeholder ${provider} key on both the buffered and the streamed call, and neither refusal showed the key or the provider's address` }
        : { pass: false, detail: wrong.join('; ') }
    },
  }
}
