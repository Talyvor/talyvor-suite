import { connect } from 'node:net'
import { describe, expect, it } from 'vitest'
import { smtpStub } from '../src/trackEmail.ts'

describe('track-assign-email SMTP stub (B39.26)', () => {
  it('keeps one message per DATA with its sender, recipient and un-dot-stuffed body', async () => {
    const smtp = await smtpStub()
    try {
      const sock = connect(smtp.port, '127.0.0.1')
      let heard = ''
      sock.on('data', (d: Buffer) => { heard += d.toString() })
      const replies = (n: number) => new Promise<void>((ok) => { const t = setInterval(() => { if ((heard.match(/\r\n/g) ?? []).length >= n) { clearInterval(t); ok() } }, 5) })
      await replies(1)
      sock.write('EHLO localhost\r\nMAIL FROM:<notifications@talyvor.test>\r\nRCPT TO:<member@e2e.test>\r\nDATA\r\n')
      await replies(5)
      sock.write('Subject: GEN-1 was assigned to you\r\n\r\n..a dot line\r\n.\r\nQUIT\r\n')
      await replies(7)
      sock.destroy()
      expect(smtp.got).toEqual([{ from: 'notifications@talyvor.test', to: ['member@e2e.test'], data: 'Subject: GEN-1 was assigned to you\r\n\r\n.a dot line' }])
    } finally {
      await smtp.close()
    }
  })
})
