export type SplitVoiceServerEvent =
  | {
      type: "ready";
      eventId: string;
      inputSampleRate: 16000;
      outputSampleRate: 24000;
      remainingSeconds: number;
    }
  | { type: "speech_started"; eventId: string }
  | { type: "speech_stopped"; eventId: string; utteranceId: string }
  | { type: "transcript"; eventId: string; utteranceId: string; text: string }
  | { type: "audio_start"; eventId: string; responseId: string; segmentId: string }
  | { type: "audio_done"; eventId: string; responseId: string; segmentId: string }
  | { type: "interrupted"; eventId: string }
  | { type: "quota_warning"; eventId: string; remainingSeconds: number }
  | { type: "quota_exhausted"; eventId: string; remainingSeconds: 0 }
  | {
      type: "error";
      eventId: string;
      code: string;
      message: string;
      recoverable: boolean;
    };

export type SplitVoiceClientEvent =
  | { type: "synthesize"; responseId: string; segmentId: string; text: string }
  | { type: "cancel" }
  | { type: "stop" };
