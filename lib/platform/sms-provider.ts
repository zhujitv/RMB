export type SmsSendInput = {
  phoneNumbers: string[];
  templateParams: string[];
  sessionContext?: string;
};

export type SmsSendResult = {
  phoneNumber: string;
  accepted: boolean;
  code: string;
  message: string;
  serialNo?: string;
  requestId?: string;
  retryable: boolean;
  outcomeUnknown: boolean;
};

export interface SmsProvider {
  send(input: SmsSendInput): Promise<SmsSendResult[]>;
}
