export type SmtpNotificationConfig = {
  host?: string
  connectionHost?: string
  port?: number
  secure?: boolean
  user?: string
  pass?: string
  from?: string
  recipients?: string
  accessToken?: string
  sessionMaxAgeSeconds?: number
  rateLimitPerHour?: number
}

export type SmtpNotificationService = {
  health: () => {
    smtpConfigured: boolean
    smtpVerified: boolean
    smtpVerificationState: string
    notificationRecipientCount: number
    notificationMaxRecipients: number
  }
  middleware: (request: any, response: any, next: any) => Promise<void>
}

export function createSmtpNotificationService(config?: SmtpNotificationConfig): SmtpNotificationService
