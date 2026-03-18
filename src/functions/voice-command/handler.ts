import {
  TranscribeClient,
  StartTranscriptionJobCommand,
  GetTranscriptionJobCommand,
} from '@aws-sdk/client-transcribe'
import { getObject } from '../../lib/s3'

const transcribe = new TranscribeClient({})

const SHUTTER_KEYWORDS = ['撮って', 'とって', 'チーズ', 'はい'] as const

interface VoiceCommandInput {
  readonly sessionId: string
  readonly audioKey: string
  readonly bucket: string
}

interface VoiceCommandOutput {
  readonly sessionId: string
  readonly transcript: string
  readonly command: 'shutter' | 'unknown'
}

/** Check if transcript matches a shutter command. */
const detectCommand = (transcript: string): 'shutter' | 'unknown' => {
  const normalized = transcript.toLowerCase()
  for (const keyword of SHUTTER_KEYWORDS) {
    if (normalized.includes(keyword)) return 'shutter'
  }
  return 'unknown'
}

export const handler = async (event: VoiceCommandInput): Promise<VoiceCommandOutput> => {
  const { sessionId, audioKey, bucket } = event

  // Verify audio exists
  await getObject(audioKey)

  const jobName = `voice-cmd-${sessionId}-${String(Date.now())}`

  await transcribe.send(
    new StartTranscriptionJobCommand({
      TranscriptionJobName: jobName,
      LanguageCode: 'ja-JP',
      MediaFormat: 'webm',
      Media: {
        MediaFileUri: `s3://${bucket}/${audioKey}`,
      },
    }),
  )

  // Poll for completion (max 10 seconds)
  let transcript = ''
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 1000))

    const job = await transcribe.send(
      new GetTranscriptionJobCommand({
        TranscriptionJobName: jobName,
      }),
    )

    const status = job.TranscriptionJob?.TranscriptionJobStatus
    if (status === 'COMPLETED') {
      const uri = job.TranscriptionJob?.Transcript?.TranscriptFileUri
      if (uri) {
        try {
          const response = await fetch(uri)
          const data = await response.json() as { results: { transcripts: { transcript: string }[] } }
          transcript = data.results.transcripts[0]?.transcript ?? ''
        } catch (err) {
          console.error('Failed to fetch transcription result:', err)
        }
      }
      break
    }
    if (status === 'FAILED') {
      console.error('Transcription job failed:', jobName)
      break
    }
  }

  return {
    sessionId,
    transcript,
    command: detectCommand(transcript),
  }
}
