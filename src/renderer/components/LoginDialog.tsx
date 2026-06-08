import { ArrowPathIcon, KeyIcon, PhoneIcon, QrCodeIcon, XMarkIcon } from '@heroicons/react/24/outline';
import React, { useEffect, useRef, useState } from 'react';

import { authService } from '../services/auth';
import { i18nService } from '../services/i18n';
import { getPolicyUrl, PrivacyPolicyContentKey } from '../services/privacyPolicy';

type LoginMode = 'sms' | 'password' | 'wechat';
type WechatStage = 'qr' | 'bind-phone';

interface LoginDialogProps {
  onClose: () => void;
  onSuccess?: () => void;
}

const LoginDialog: React.FC<LoginDialogProps> = ({ onClose, onSuccess }) => {
  const [mode, setMode] = useState<LoginMode>('sms');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [captchaId, setCaptchaId] = useState<number | null>(null);
  const [captchaImage, setCaptchaImage] = useState('');
  const [captchaValue, setCaptchaValue] = useState('');
  const [isLoadingCaptcha, setIsLoadingCaptcha] = useState(false);
  const [isSendingCode, setIsSendingCode] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [agreedToPolicies, setAgreedToPolicies] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wechatStage, setWechatStage] = useState<WechatStage>('qr');
  const [wechatQrCodeUrl, setWechatQrCodeUrl] = useState('');
  const [wechatSceneCode, setWechatSceneCode] = useState('');
  const [wechatRegisterToken, setWechatRegisterToken] = useState('');
  const [isWechatLoading, setIsWechatLoading] = useState(false);
  const wechatQrRequestSeqRef = useRef(0);
  const wechatQrLoadInFlightRef = useRef(false);

  const loadCaptcha = async () => {
    setIsLoadingCaptcha(true);
    try {
      const result = await authService.requestCaptcha();
      if (!result.success || !result.captcha) {
        setError(result.error || i18nService.t('loginCaptchaFailed'));
        return;
      }
      setCaptchaId(result.captcha.id);
      setCaptchaImage(result.captcha.data);
      setCaptchaValue('');
    } catch (err) {
      setError(err instanceof Error ? err.message : i18nService.t('loginCaptchaFailed'));
    } finally {
      setIsLoadingCaptcha(false);
    }
  };

  useEffect(() => {
    void loadCaptcha();
  }, []);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = window.setTimeout(() => setCountdown(value => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [countdown]);

  useEffect(() => {
    if (mode !== 'wechat' || wechatStage !== 'qr' || !wechatSceneCode) {
      return;
    }

    let cancelled = false;
    let nextPollTimer: number | null = null;

    const stopPolling = () => {
      cancelled = true;
      setWechatSceneCode('');
      if (nextPollTimer !== null) {
        window.clearTimeout(nextPollTimer);
        nextPollTimer = null;
      }
    };

    // 后端长轮询接口：串行发起轮询
    const pollOnce = async () => {
      try {
        const result = await authService.checkWechatLogin({ sceneCode: wechatSceneCode });
        if (cancelled) return;
        if (!result.success) {
          setError(result.error || i18nService.t('loginFailed'));
          return;
        }
        if (result.user) {
          stopPolling();
          await authService.finalizeLoginResult(result);
          onSuccess?.();
          onClose();
          return;
        }
        if (result.needBindPhone === true && result.registerToken) {
          stopPolling();
          setWechatRegisterToken(result.registerToken);
          setWechatStage('bind-phone');
          setPhone('');
          setCode('');
          setCaptchaValue('');
          setError(null);
          void loadCaptcha();
          return;
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : i18nService.t('loginFailed'));
        }
      }

      if (!cancelled) {
        nextPollTimer = window.setTimeout(() => {
          void pollOnce();
        }, 300);
      }
    };

    // StrictMode 下 effect 会先 mount/cleanup 再 mount，这里延迟一拍启动，避免首轮假挂载发出长轮询。
    nextPollTimer = window.setTimeout(() => {
      void pollOnce();
    }, 0);

    return () => {
      cancelled = true;
      if (nextPollTimer !== null) {
        window.clearTimeout(nextPollTimer);
      }
    };
  }, [mode, onClose, onSuccess, wechatSceneCode, wechatStage]);

  const captchaSrc = captchaImage
    ? captchaImage.startsWith('data:')
      ? captchaImage
      : `data:image/png;base64,${captchaImage}`
    : '';

  // 进入微信登录时按需拉取二维码，避免首次渲染就产生额外请求。
  const loadWechatQrCode = async () => {
    if (wechatQrLoadInFlightRef.current) {
      return;
    }

    const requestSeq = wechatQrRequestSeqRef.current + 1;
    wechatQrRequestSeqRef.current = requestSeq;
    wechatQrLoadInFlightRef.current = true;
    setIsWechatLoading(true);
    setError(null);
    setWechatSceneCode('');
    try {
      const result = await authService.getWechatQrCode();
      if (wechatQrRequestSeqRef.current !== requestSeq) {
        return;
      }
      if (!result.success || !result.data) {
        setError(result.error || i18nService.t('loginFailed'));
        return;
      }
      setWechatStage('qr');
      setWechatQrCodeUrl(result.data.qrCodeUrl);
      setWechatSceneCode(result.data.sceneCode);
      setWechatRegisterToken('');
    } catch (err) {
      if (wechatQrRequestSeqRef.current === requestSeq) {
        setError(err instanceof Error ? err.message : i18nService.t('loginFailed'));
      }
    } finally {
      if (wechatQrRequestSeqRef.current === requestSeq) {
        setIsWechatLoading(false);
      }
      wechatQrLoadInFlightRef.current = false;
    }
  };

  useEffect(() => {
    if (mode === 'wechat' && !wechatQrCodeUrl && !isWechatLoading) {
      void loadWechatQrCode();
    }
  }, [isWechatLoading, mode, wechatQrCodeUrl]);

  const handleSendCode = async () => {
    setError(null);
    if (!phone.trim() || !captchaId || !captchaValue.trim()) {
      setError(i18nService.t('loginSmsFieldsRequired'));
      return;
    }
    setIsSendingCode(true);
    try {
      const result = await authService.sendSmsCode({
        phone: phone.trim(),
        captchaId,
        captchaValue: captchaValue.trim(),
      });
      console.log('result==>', result);
      if (!result.success) {
        setError(result.error || i18nService.t('loginSmsSendFailed'));
        void loadCaptcha();
        return;
      }
      setCountdown(60);
    } catch (err) {
      setError(err instanceof Error ? err.message : i18nService.t('loginSmsSendFailed'));
    } finally {
      setIsSendingCode(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!agreedToPolicies) {
      setError(i18nService.t('loginAgreementRequired'));
      return;
    }
    setIsSubmitting(true);
    try {
      const result = mode === 'sms'
        ? await authService.loginWithCode({
          phone: phone.trim(),
          code: code.trim(),
          inviteCode: inviteCode.trim() || undefined,
        })
        : mode === 'password'
          ? await authService.loginWithPassword({
            username: username.trim(),
            password,
            inviteCode: inviteCode.trim() || undefined,
          })
          : await authService.registerWechatByPhone({
            registerToken: wechatRegisterToken,
            phone: phone.trim(),
            code: code.trim(),
            inviteCode: inviteCode.trim() || undefined,
          });

      if (!result.success) {
        setError(result.error || i18nService.t('loginFailed'));
        return;
      }
      onSuccess?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : i18nService.t('loginFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenExternal = async (event: React.MouseEvent, key: PrivacyPolicyContentKey) => {
    event.preventDefault();
    const url = await getPolicyUrl(key);
    await window.electron.shell.openExternal(url);
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/35 px-4 backdrop-blur-sm">
      <div className="relative grid w-full max-w-[760px] overflow-hidden rounded-xl border border-border bg-surface text-foreground shadow-popover md:grid-cols-[0.92fr_1.08fr]">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 z-10 inline-flex h-8 w-8 items-center justify-center rounded-md text-secondary transition hover:bg-surface-raised hover:text-foreground"
          aria-label={i18nService.t('close')}
        >
          <XMarkIcon className="h-4 w-4" />
        </button>

        <div className="hidden min-h-[500px] border-r border-border bg-surface-raised p-8 md:flex md:flex-col md:justify-between">
          <div>
            <div className="mb-8 inline-flex h-9 items-center gap-2 rounded-md border border-border bg-surface px-3 text-xs font-medium text-secondary">
              <KeyIcon className="h-4 w-4 text-primary" />
              {i18nService.t('loginGatewayLabel')}
            </div>
            <div>
              <h2 className="max-w-[15rem] text-2xl font-semibold leading-8 text-foreground">
                {i18nService.t('loginHeroTitle')}
              </h2>
              <p className="mt-4 max-w-[17rem] text-sm leading-6 text-secondary">
                {i18nService.t('loginHeroSubtitle')}
              </p>
            </div>
          </div>
          <div className="space-y-3 text-xs text-secondary">
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              <span>{i18nService.t('loginAccountServerReady')}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              <span>{i18nService.t('loginGatewayReady')}</span>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6 sm:p-8">
          <div className="mb-7 pr-10">
            <div className="mb-2 text-sm font-medium text-primary">{i18nService.t('loginWelcome')}</div>
            <h1 className="text-xl font-semibold text-foreground">{i18nService.t('loginTitle')}</h1>
          </div>

          <div className="mb-5 grid grid-cols-3 rounded-lg border border-border bg-surface-raised p-1">
            <button
              type="button"
              onClick={() => setMode('sms')}
              className={`flex h-9 items-center justify-center gap-2 rounded-md text-sm transition ${mode === 'sms' ? 'bg-surface font-medium text-foreground shadow-sm' : 'text-secondary hover:text-foreground'}`}
            >
              <PhoneIcon className="h-4 w-4" />
              {i18nService.t('loginSmsTab')}
            </button>
            <button
              type="button"
              onClick={() => setMode('password')}
              className={`flex h-9 items-center justify-center gap-2 rounded-md text-sm transition ${mode === 'password' ? 'bg-surface font-medium text-foreground shadow-sm' : 'text-secondary hover:text-foreground'}`}
            >
              <KeyIcon className="h-4 w-4" />
              {i18nService.t('loginPasswordTab')}
            </button>
            <button
              type="button"
              onClick={() => setMode('wechat')}
              className={`flex h-9 items-center justify-center gap-2 rounded-md text-sm transition ${mode === 'wechat' ? 'bg-surface font-medium text-foreground shadow-sm' : 'text-secondary hover:text-foreground'}`}
            >
              <QrCodeIcon className="h-4 w-4" />
              {i18nService.t('loginWechatTab')}
            </button>
          </div>

          <div className="space-y-3">
            {mode === 'sms' ? (
              <>
                <input
                  value={phone}
                  onChange={event => setPhone(event.target.value)}
                  className="h-11 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none transition placeholder:text-secondary/70 focus:border-primary"
                  placeholder={i18nService.t('loginPhonePlaceholder')}
                />
                <div className="grid grid-cols-[1fr_auto] gap-2">
                  <input
                    value={captchaValue}
                    onChange={event => setCaptchaValue(event.target.value)}
                    className="h-11 min-w-0 rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none transition placeholder:text-secondary/70 focus:border-primary"
                    placeholder={i18nService.t('loginCaptchaPlaceholder')}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      void loadCaptcha();
                    }}
                    className="flex h-11 w-28 items-center justify-center overflow-hidden rounded-lg border border-border bg-surface-raised text-foreground transition hover:bg-surface"
                  >
                    {isLoadingCaptcha ? (
                      <ArrowPathIcon className="h-4 w-4 animate-spin" />
                    ) : captchaSrc ? (
                      <img src={captchaSrc} alt={i18nService.t('loginCaptchaAlt')} className="h-full w-full object-cover" />
                    ) : (
                      <span className="text-xs">{i18nService.t('loginRefreshCaptcha')}</span>
                    )}
                  </button>
                </div>
                <div className="grid grid-cols-[1fr_auto] gap-2">
                  <input
                    value={code}
                    onChange={event => setCode(event.target.value)}
                    className="h-11 min-w-0 rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none transition placeholder:text-secondary/70 focus:border-primary"
                    placeholder={i18nService.t('loginSmsCodePlaceholder')}
                  />
                  <button
                    type="button"
                    disabled={isSendingCode || countdown > 0}
                    onClick={() => void handleSendCode()}
                    className="h-11 rounded-lg border border-border bg-surface-raised px-3 text-sm font-medium text-foreground transition hover:bg-surface disabled:cursor-not-allowed disabled:text-secondary"
                  >
                    {countdown > 0 ? `${countdown}s` : i18nService.t('loginSendCode')}
                  </button>
                </div>
              </>
            ) : mode === 'password' ? (
              <>
                <input
                  value={username}
                  onChange={event => setUsername(event.target.value)}
                  className="h-11 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none transition placeholder:text-secondary/70 focus:border-primary"
                  placeholder={i18nService.t('loginUsernamePlaceholder')}
                />
                <input
                  value={password}
                  onChange={event => setPassword(event.target.value)}
                  type="password"
                  className="h-11 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none transition placeholder:text-secondary/70 focus:border-primary"
                  placeholder={i18nService.t('loginPasswordPlaceholder')}
                />
              </>
            ) : wechatStage === 'qr' ? (
              <div className="space-y-4 py-2">
                <div className="text-center text-sm text-secondary">
                  {i18nService.t('loginWechatScanTip')}
                </div>
                <div className="flex justify-center">
                  {wechatQrCodeUrl ? (
                    <img
                      src={wechatQrCodeUrl}
                      alt={i18nService.t('loginWechatQrAlt')}
                      className="h-48 w-48"
                    />
                  ) : (
                    <div className="flex h-48 w-48 items-center justify-center text-sm text-secondary">
                      {isWechatLoading ? i18nService.t('loginWechatLoading') : i18nService.t('loginWechatQrUnavailable')}
                    </div>
                  )}
                </div>
                <div className="flex justify-center">
                  <button
                    type="button"
                    onClick={() => void loadWechatQrCode()}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-primary transition hover:bg-surface-raised"
                  >
                    <ArrowPathIcon className={`h-4 w-4 ${isWechatLoading ? 'animate-spin' : ''}`} />
                    {i18nService.t('loginWechatRefreshQr')}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-secondary">
                  {i18nService.t('loginWechatBindTip')}
                </div>
                <input
                  value={phone}
                  onChange={event => setPhone(event.target.value)}
                  className="h-11 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none transition placeholder:text-secondary/70 focus:border-primary"
                  placeholder={i18nService.t('loginPhonePlaceholder')}
                />
                <div className="grid grid-cols-[1fr_auto] gap-2">
                  <input
                    value={captchaValue}
                    onChange={event => setCaptchaValue(event.target.value)}
                    className="h-11 min-w-0 rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none transition placeholder:text-secondary/70 focus:border-primary"
                    placeholder={i18nService.t('loginCaptchaPlaceholder')}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      void loadCaptcha();
                    }}
                    className="flex h-11 w-28 items-center justify-center overflow-hidden rounded-lg border border-border bg-surface-raised text-foreground transition hover:bg-surface"
                  >
                    {isLoadingCaptcha ? (
                      <ArrowPathIcon className="h-4 w-4 animate-spin" />
                    ) : captchaSrc ? (
                      <img src={captchaSrc} alt={i18nService.t('loginCaptchaAlt')} className="h-full w-full object-cover" />
                    ) : (
                      <span className="text-xs">{i18nService.t('loginRefreshCaptcha')}</span>
                    )}
                  </button>
                </div>
                <div className="grid grid-cols-[1fr_auto] gap-2">
                  <input
                    value={code}
                    onChange={event => setCode(event.target.value)}
                    className="h-11 min-w-0 rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none transition placeholder:text-secondary/70 focus:border-primary"
                    placeholder={i18nService.t('loginSmsCodePlaceholder')}
                  />
                  <button
                    type="button"
                    disabled={isSendingCode || countdown > 0}
                    onClick={() => void handleSendCode()}
                    className="h-11 rounded-lg border border-border bg-surface-raised px-3 text-sm font-medium text-foreground transition hover:bg-surface disabled:cursor-not-allowed disabled:text-secondary"
                  >
                    {countdown > 0 ? `${countdown}s` : i18nService.t('loginSendCode')}
                  </button>
                </div>
              </>
            )}
            {(mode !== 'wechat' || wechatStage === 'bind-phone') && (
              <input
                value={inviteCode}
                onChange={event => setInviteCode(event.target.value)}
                className="h-11 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none transition placeholder:text-secondary/70 focus:border-primary"
                placeholder={i18nService.t('loginInvitePlaceholder')}
              />
            )}
          </div>

          {error && (
            <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-300">
              {error}
            </div>
          )}

          <div className="mt-4 space-y-3">
            {mode === 'wechat' && wechatStage === 'qr' ? (
              <div className="text-center text-xs leading-5 text-secondary">
                <span>{i18nService.t('loginAgreementByLoginPrefix')}</span>
                <a
                  href="#"
                  onClick={event => void handleOpenExternal(event, PrivacyPolicyContentKey.UserTerms)}
                  className="text-primary transition hover:text-primary-hover"
                >
                  {i18nService.t('loginAgreementTermsLinkText')}
                </a>
                {i18nService.t('loginAgreementConnector')}
                <a
                  href="#"
                  onClick={event => void handleOpenExternal(event, PrivacyPolicyContentKey.PrivacyPolicy)}
                  className="text-primary transition hover:text-primary-hover"
                >
                  {i18nService.t('loginAgreementPrivacyLinkText')}
                </a>
              </div>
            ) : (
              <label className="flex items-start gap-3 text-xs leading-5 text-secondary">
                <input
                  type="checkbox"
                  checked={agreedToPolicies}
                  onChange={event => setAgreedToPolicies(event.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-primary"
                />
                <span>
                  {i18nService.t('loginAgreementCheckboxPrefix')}
                  <a
                    href="#"
                    onClick={event => void handleOpenExternal(event, PrivacyPolicyContentKey.UserTerms)}
                    className="text-primary transition hover:text-primary-hover"
                  >
                    {i18nService.t('loginAgreementTermsLinkText')}
                  </a>
                  {i18nService.t('loginAgreementConnector')}
                  <a
                    href="#"
                    onClick={event => void handleOpenExternal(event, PrivacyPolicyContentKey.PrivacyPolicy)}
                    className="text-primary transition hover:text-primary-hover"
                  >
                    {i18nService.t('loginAgreementPrivacyLinkText')}
                  </a>
                </span>
              </label>
            )}
          </div>

          {!(mode === 'wechat' && wechatStage === 'qr') && (
            <button
              type="submit"
              disabled={isSubmitting || !agreedToPolicies}
              className="mt-6 flex h-11 w-full items-center justify-center rounded-lg bg-primary text-sm font-medium text-white transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? i18nService.t('loginSubmitting') : i18nService.t('loginSubmit')}
            </button>
          )}
        </form>
      </div>
    </div>
  );
};

export default LoginDialog;
