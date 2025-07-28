import { Page } from 'playwright';
import { Solver } from '@2captcha/captcha-solver';
import logger from '@/utils/logger';

export interface CaptchaConfig {
  apiKey?: string;
  timeout?: number;
  pollingInterval?: number;
  maxRetries?: number;
}

export interface CaptchaSolution {
  solution: string;
  responseTime: number;
  cost?: number;
}

export interface RecaptchaV2Options {
  siteKey: string;
  pageUrl: string;
  invisible?: boolean;
  enterprise?: boolean;
}

export interface RecaptchaV3Options {
  siteKey: string;
  pageUrl: string;
  action?: string;
  score?: number;
  enterprise?: boolean;
}

export interface TurnstileOptions {
  siteKey: string;
  pageUrl: string;
}

export interface HCaptchaOptions {
  siteKey: string;
  pageUrl: string;
}

export class CaptchaSolver {
  private solver: Solver | null = null;
  private config: CaptchaConfig;
  private isEnabled: boolean = false;

  constructor(captchaConfig: CaptchaConfig = {}) {
    this.config = {
      timeout: 300000, // 5 minutes
      pollingInterval: 10000, // 10 seconds
      maxRetries: 3,
      ...captchaConfig
    };

    // Initialize 2Captcha if API key is provided
    if (this.config.apiKey) {
      try {
        this.solver = new Solver(this.config.apiKey);
        this.isEnabled = true;
        logger.info('CaptchaSolver initialized with 2Captcha API');
      } catch (error) {
        logger.error('Failed to initialize CaptchaSolver', { error });
      }
    } else {
      logger.warn('CaptchaSolver disabled - no API key provided');
    }
  }

  async detectCaptcha(page: Page): Promise<{ type: string; siteKey?: string } | null> {
    try {
      // Check for reCAPTCHA v2
      const recaptchaV2 = await page.$('.g-recaptcha');
      if (recaptchaV2) {
        const siteKey = await recaptchaV2.getAttribute('data-sitekey');
        return { type: 'recaptcha-v2', siteKey: siteKey || undefined };
      }

      // Check for reCAPTCHA v3 (invisible)
      const recaptchaV3Scripts = await page.$$eval('script', scripts => 
        scripts.filter(script => 
          script.src && script.src.includes('recaptcha') && script.src.includes('render=')
        ).map(script => {
          const match = script.src.match(/render=([^&]+)/);
          return match ? match[1] : null;
        }).filter(Boolean)
      );

      if (recaptchaV3Scripts.length > 0) {
        return { type: 'recaptcha-v3', siteKey: recaptchaV3Scripts[0] };
      }

      // Check for hCaptcha
      const hcaptcha = await page.$('.h-captcha');
      if (hcaptcha) {
        const siteKey = await hcaptcha.getAttribute('data-sitekey');
        return { type: 'hcaptcha', siteKey: siteKey || undefined };
      }

      // Check for Cloudflare Turnstile
      const turnstile = await page.$('.cf-turnstile');
      if (turnstile) {
        const siteKey = await turnstile.getAttribute('data-sitekey');
        return { type: 'turnstile', siteKey: siteKey || undefined };
      }

      // Check for Cloudflare challenge page
      const cfChallenge = await page.$('#cf-challenge-stage');
      if (cfChallenge) {
        return { type: 'cloudflare-challenge' };
      }

      // Check for generic CAPTCHA images
      const captchaImage = await page.$('img[src*="captcha"]');
      if (captchaImage) {
        return { type: 'image-captcha' };
      }

      return null;
    } catch (error) {
      logger.error('Error detecting CAPTCHA', { error });
      return null;
    }
  }

  async solveRecaptchaV2(options: RecaptchaV2Options): Promise<CaptchaSolution> {
    if (!this.isEnabled || !this.solver) {
      throw new Error('CaptchaSolver not initialized or disabled');
    }

    logger.info('Solving reCAPTCHA v2', { siteKey: options.siteKey, url: options.pageUrl });
    const startTime = Date.now();

    try {
      const solution = await this.solver.recaptcha({
        googlekey: options.siteKey,
        pageurl: options.pageUrl,
        invisible: options.invisible ? 1 : 0,
        enterprise: options.enterprise ? 1 : 0
      });

      const responseTime = Date.now() - startTime;
      
      logger.info('reCAPTCHA v2 solved successfully', { 
        responseTime, 
        siteKey: options.siteKey 
      });

      return {
        solution: solution.data,
        responseTime
      };
    } catch (error) {
      logger.error('Failed to solve reCAPTCHA v2', { error, options });
      throw error;
    }
  }

  async solveRecaptchaV3(options: RecaptchaV3Options): Promise<CaptchaSolution> {
    if (!this.isEnabled || !this.solver) {
      throw new Error('CaptchaSolver not initialized or disabled');
    }

    logger.info('Solving reCAPTCHA v3', { siteKey: options.siteKey, url: options.pageUrl });
    const startTime = Date.now();

    try {
      const solution = await this.solver.recaptcha({
        googlekey: options.siteKey,
        pageurl: options.pageUrl,
        version: 'v3',
        action: options.action || 'verify',
        enterprise: options.enterprise ? 1 : 0
      });

      const responseTime = Date.now() - startTime;
      
      logger.info('reCAPTCHA v3 solved successfully', { 
        responseTime, 
        siteKey: options.siteKey 
      });

      return {
        solution: solution.data,
        responseTime
      };
    } catch (error) {
      logger.error('Failed to solve reCAPTCHA v3', { error, options });
      throw error;
    }
  }

  async solveTurnstile(options: TurnstileOptions): Promise<CaptchaSolution> {
    if (!this.isEnabled || !this.solver) {
      throw new Error('CaptchaSolver not initialized or disabled');
    }

    logger.info('Solving Cloudflare Turnstile', { siteKey: options.siteKey, url: options.pageUrl });
    const startTime = Date.now();

    try {
      // Note: Turnstile support may vary by 2Captcha library version
      // Using generic method if turnstile-specific method is not available
      const solution = await (this.solver as any).turnstile?.({
        sitekey: options.siteKey,
        pageurl: options.pageUrl
      }) || await this.solver.recaptcha({
        googlekey: options.siteKey,
        pageurl: options.pageUrl
      });

      const responseTime = Date.now() - startTime;
      
      logger.info('Cloudflare Turnstile solved successfully', { 
        responseTime, 
        siteKey: options.siteKey 
      });

      return {
        solution: solution.data,
        responseTime
      };
    } catch (error) {
      logger.error('Failed to solve Cloudflare Turnstile', { error, options });
      throw error;
    }
  }

  async solveHCaptcha(options: HCaptchaOptions): Promise<CaptchaSolution> {
    if (!this.isEnabled || !this.solver) {
      throw new Error('CaptchaSolver not initialized or disabled');
    }

    logger.info('Solving hCaptcha', { siteKey: options.siteKey, url: options.pageUrl });
    const startTime = Date.now();

    try {
      const solution = await this.solver.hcaptcha({
        sitekey: options.siteKey,
        pageurl: options.pageUrl
      });

      const responseTime = Date.now() - startTime;
      
      logger.info('hCaptcha solved successfully', { 
        responseTime, 
        siteKey: options.siteKey 
      });

      return {
        solution: solution.data,
        responseTime
      };
    } catch (error) {
      logger.error('Failed to solve hCaptcha', { error, options });
      throw error;
    }
  }

  async handleCaptchaOnPage(page: Page): Promise<boolean> {
    if (!this.isEnabled) {
      logger.warn('CAPTCHA detected but solver is disabled');
      return false;
    }

    try {
      const captcha = await this.detectCaptcha(page);
      if (!captcha) {
        return true; // No CAPTCHA found
      }

      logger.info('CAPTCHA detected', { type: captcha.type, siteKey: captcha.siteKey });

      const pageUrl = page.url();
      let solution: CaptchaSolution;

      switch (captcha.type) {
        case 'recaptcha-v2':
          if (!captcha.siteKey) throw new Error('Missing siteKey for reCAPTCHA v2');
          solution = await this.solveRecaptchaV2({
            siteKey: captcha.siteKey,
            pageUrl
          });
          await this.submitRecaptchaV2Solution(page, solution.solution);
          break;

        case 'recaptcha-v3':
          if (!captcha.siteKey) throw new Error('Missing siteKey for reCAPTCHA v3');
          solution = await this.solveRecaptchaV3({
            siteKey: captcha.siteKey,
            pageUrl
          });
          await this.submitRecaptchaV3Solution(page, solution.solution);
          break;

        case 'turnstile':
          if (!captcha.siteKey) throw new Error('Missing siteKey for Turnstile');
          solution = await this.solveTurnstile({
            siteKey: captcha.siteKey,
            pageUrl
          });
          await this.submitTurnstileSolution(page, solution.solution);
          break;

        case 'hcaptcha':
          if (!captcha.siteKey) throw new Error('Missing siteKey for hCaptcha');
          solution = await this.solveHCaptcha({
            siteKey: captcha.siteKey,
            pageUrl
          });
          await this.submitHCaptchaSolution(page, solution.solution);
          break;

        case 'cloudflare-challenge':
          logger.warn('Cloudflare challenge detected - waiting for automatic resolution');
          await page.waitForTimeout(5000);
          return true;

        default:
          logger.warn('Unsupported CAPTCHA type', { type: captcha.type });
          return false;
      }

      // Wait for page to process the solution
      await page.waitForTimeout(2000);
      
      // Check if CAPTCHA was solved successfully
      const stillHasCaptcha = await this.detectCaptcha(page);
      return !stillHasCaptcha;

    } catch (error) {
      logger.error('Failed to handle CAPTCHA', { error });
      return false;
    }
  }

  private async submitRecaptchaV2Solution(page: Page, solution: string): Promise<void> {
    await page.evaluate((token) => {
      const textarea = document.querySelector('#g-recaptcha-response') as HTMLTextAreaElement;
      if (textarea) {
        textarea.value = token;
        textarea.style.display = 'block';
      }
      
      // Trigger callback if exists
      if ((window as any).grecaptcha && (window as any).grecaptcha.getResponse) {
        const callback = (window as any).grecaptcha.getResponse();
        if (typeof callback === 'function') {
          callback(token);
        }
      }
    }, solution);
  }

  private async submitRecaptchaV3Solution(page: Page, solution: string): Promise<void> {
    await page.evaluate((token) => {
      // Set the token in a hidden field or trigger the callback
      const hiddenInput = document.querySelector('input[name="g-recaptcha-response"]') as HTMLInputElement;
      if (hiddenInput) {
        hiddenInput.value = token;
      }

      // Trigger any reCAPTCHA v3 callbacks
      if ((window as any).grecaptcha && (window as any).grecaptcha.ready) {
        (window as any).grecaptcha.ready(() => {
          if ((window as any).onRecaptchaSuccess) {
            (window as any).onRecaptchaSuccess(token);
          }
        });
      }
    }, solution);
  }

  private async submitTurnstileSolution(page: Page, solution: string): Promise<void> {
    await page.evaluate((token) => {
      const input = document.querySelector('input[name="cf-turnstile-response"]') as HTMLInputElement;
      if (input) {
        input.value = token;
      }

      // Trigger Turnstile callback
      if ((window as any).turnstile && (window as any).turnstile.getResponse) {
        const callback = (window as any).turnstile.getResponse();
        if (typeof callback === 'function') {
          callback(token);
        }
      }
    }, solution);
  }

  private async submitHCaptchaSolution(page: Page, solution: string): Promise<void> {
    await page.evaluate((token) => {
      const textarea = document.querySelector('textarea[name="h-captcha-response"]') as HTMLTextAreaElement;
      if (textarea) {
        textarea.value = token;
      }

      // Trigger hCaptcha callback
      if ((window as any).hcaptcha && (window as any).hcaptcha.getResponse) {
        const callback = (window as any).hcaptcha.getResponse();
        if (typeof callback === 'function') {
          callback(token);
        }
      }
    }, solution);
  }

  getStatus() {
    return {
      enabled: this.isEnabled,
      hasApiKey: !!this.config.apiKey,
      config: {
        timeout: this.config.timeout,
        pollingInterval: this.config.pollingInterval,
        maxRetries: this.config.maxRetries
      }
    };
  }
}

// Create singleton instance
const captchaConfig: CaptchaConfig = {
  apiKey: process.env.CAPTCHA_API_KEY || process.env.TWOCAPTCHA_API_KEY,
  timeout: 300000, // 5 minutes
  pollingInterval: 10000, // 10 seconds
  maxRetries: 3
};

export const captchaSolver = new CaptchaSolver(captchaConfig);
export default captchaSolver;