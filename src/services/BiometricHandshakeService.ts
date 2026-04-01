export interface BiometricPayload {
  sessionToken?: string;
  primaryCamera?: {
    faceDetected?: boolean;
  };
  secondaryCamera?: {
    faceLiveness?: boolean;
    confidence?: number;
  };
}

export class BiometricHandshakeService {
  constructor(private readonly minConfidence = 0.9) {}

  validateInitialHandshake(payload: BiometricPayload): boolean {
    if (!payload.sessionToken) {
      return false;
    }

    const faceDetected = payload.primaryCamera?.faceDetected === true;
    const liveness = payload.secondaryCamera?.faceLiveness === true;
    const confidence = payload.secondaryCamera?.confidence ?? 0;

    return faceDetected && liveness && confidence >= this.minConfidence;
  }

  shouldTerminateForLiveness(payload: BiometricPayload): boolean {
    return payload.secondaryCamera?.faceLiveness !== true;
  }
}
