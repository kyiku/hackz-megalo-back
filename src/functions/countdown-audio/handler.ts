import { PollyClient, SynthesizeSpeechCommand } from '@aws-sdk/client-polly'
import { putObject } from '../../lib/s3'

const polly = new PollyClient({})

const COUNTDOWN_TEXTS = [
  { key: 'countdown/3.mp3', text: '3' },
  { key: 'countdown/2.mp3', text: '2' },
  { key: 'countdown/1.mp3', text: '1' },
  { key: 'countdown/cheese.mp3', text: 'はい、チーズ！' },
] as const

interface CountdownAudioOutput {
  readonly audioKeys: readonly string[]
}

export const handler = async (): Promise<CountdownAudioOutput> => {
  const audioKeys = await Promise.all(
    COUNTDOWN_TEXTS.map(async ({ key, text }) => {
      const response = await polly.send(
        new SynthesizeSpeechCommand({
          Text: text,
          OutputFormat: 'mp3',
          VoiceId: 'Mizuki',
          LanguageCode: 'ja-JP',
          Engine: 'neural',
        }),
      )

      const bytes = await response.AudioStream?.transformToByteArray()
      if (!bytes) throw new Error('Empty audio stream from Polly')

      await putObject(key, Buffer.from(bytes), 'audio/mpeg')
      return key
    }),
  )

  return { audioKeys }
}
