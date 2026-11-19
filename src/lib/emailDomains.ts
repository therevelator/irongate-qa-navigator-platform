/**
 * Public (free, personal) e-mail providers: the ONE list used by registration (server) and the
 * registration form (UI). Pure, no dependencies.
 *
 * An organisation is created with the e-mail domain of the person who registers it
 * (companies.domain). A company domain (acme.com) belongs to one organisation only: a second
 * registration with it is refused, and the person asks the existing organisation's administrator
 * for an invitation. A public domain (gmail.com, outlook.com, …) says nothing about an employer, so
 * it never blocks a registration and many organisations may share it (companies.email_domain_public,
 * migration 20261124000000_public_email_domains.sql).
 *
 * Nothing in the app joins or matches a person to an organisation by their e-mail domain: people
 * join an organisation only by an invitation (or an account an administrator creates), and single
 * sign-on matches an existing account or an open invitation for the exact verified address.
 */
export const PUBLIC_EMAIL_DOMAINS: readonly string[] = [
  'gmail.com', 'googlemail.com',
  'outlook.com', 'outlook.co.uk', 'outlook.de', 'outlook.fr', 'hotmail.com', 'hotmail.co.uk', 'hotmail.de', 'hotmail.fr',
  'hotmail.it', 'hotmail.es', 'live.com', 'live.co.uk', 'live.de', 'live.fr', 'live.nl', 'msn.com', 'passport.com',
  'yahoo.com', 'yahoo.co.uk', 'yahoo.de', 'yahoo.fr', 'yahoo.it', 'yahoo.es', 'yahoo.ca', 'yahoo.com.au', 'yahoo.co.in',
  'yahoo.co.jp', 'ymail.com', 'rocketmail.com',
  'icloud.com', 'me.com', 'mac.com',
  'aol.com', 'aim.com',
  'proton.me', 'protonmail.com', 'protonmail.ch', 'pm.me',
  'gmx.com', 'gmx.de', 'gmx.net', 'gmx.at', 'gmx.ch', 'web.de', 'mail.com', 'email.com', 'freenet.de', 't-online.de',
  'zoho.com', 'zohomail.com', 'yandex.com', 'yandex.ru', 'ya.ru', 'mail.ru', 'inbox.ru', 'bk.ru', 'list.ru', 'rambler.ru',
  'tutanota.com', 'tutanota.de', 'tutamail.com', 'tuta.io', 'tuta.com', 'fastmail.com', 'fastmail.fm', 'hey.com',
  'mailbox.org', 'posteo.de', 'posteo.net', 'hushmail.com', 'runbox.com', 'disroot.org',
  'qq.com', '163.com', '126.com', 'yeah.net', 'sina.com', 'naver.com', 'daum.net', 'hanmail.net',
  'orange.fr', 'wanadoo.fr', 'free.fr', 'laposte.net', 'sfr.fr', 'libero.it', 'virgilio.it', 'tiscali.it',
  'btinternet.com', 'sky.com', 'virginmedia.com', 'talktalk.net', 'ntlworld.com',
  'comcast.net', 'verizon.net', 'att.net', 'sbcglobal.net', 'bellsouth.net', 'cox.net', 'charter.net', 'earthlink.net',
  'rediffmail.com', 'seznam.cz', 'wp.pl', 'o2.pl', 'interia.pl', 'onet.pl', 'abv.bg', 'bol.com.br', 'uol.com.br',
];

const PUBLIC = new Set(PUBLIC_EMAIL_DOMAINS);

/** The domain of an e-mail address, lower case and trimmed ('' when there is none). */
export function emailDomainOf(email: string | null | undefined): string {
  const at = (email ?? '').trim().lastIndexOf('@');
  return at < 0 ? '' : (email ?? '').trim().slice(at + 1).toLowerCase();
}

/** True for a public e-mail provider such as gmail.com (never tied to one organisation). */
export function isPublicEmailDomain(domain: string | null | undefined): boolean {
  return PUBLIC.has((domain ?? '').trim().toLowerCase().replace(/\.$/, ''));
}
