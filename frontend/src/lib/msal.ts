import { PublicClientApplication, type Configuration, LogLevel } from '@azure/msal-browser';

const clientId = import.meta.env.VITE_AZURE_AD_CLIENT_ID as string | undefined;
const tenantId = (import.meta.env.VITE_AZURE_AD_TENANT_ID as string | undefined) || 'common';

export const msalConfigured = Boolean(clientId);

const msalConfig: Configuration = {
  auth: {
    clientId: clientId || '00000000-0000-0000-0000-000000000000',
    authority: `https://login.microsoftonline.com/${tenantId}`,
    redirectUri: window.location.origin,
    postLogoutRedirectUri: window.location.origin,
  },
  cache: {
    cacheLocation: 'localStorage' as const,
  },
  system: {
    loggerOptions: {
      logLevel: LogLevel.Verbose,
      loggerCallback: (_l, msg) => console.debug('[MSAL]', msg),
      piiLoggingEnabled: false,
    },
  },
};

export const msalInstance = new PublicClientApplication(msalConfig);

export const msalLoginRequest = {
  scopes: ['openid', 'profile', 'email', 'User.Read'],
};
