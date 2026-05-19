import { createHmac } from 'node:crypto';
import { IncomingMessage } from 'node:http';
import { isIP } from 'node:net';

export function resolveClientIp(req: IncomingMessage, trustProxy: boolean): string | null {
  if (trustProxy) {
    const forwardedHeader = req.headers['x-forwarded-for'];
    const forwardedValue = Array.isArray(forwardedHeader) ? forwardedHeader[0] : forwardedHeader;
    const forwardedIp = forwardedValue?.split(',')[0]?.trim();
    const normalizedForwardedIp = normalizeIp(forwardedIp);

    if (normalizedForwardedIp) return normalizedForwardedIp;
  }

  return normalizeIp(req.socket.remoteAddress);
}

export function normalizeIp(candidate: string | undefined | null): string | null {
  if (!candidate) return null;

  let value = candidate.trim().toLowerCase();
  if (!value) return null;

  if (value.startsWith('[') && value.endsWith(']')) {
    value = value.slice(1, -1);
  }

  if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(value)) {
    value = value.slice(0, value.lastIndexOf(':'));
  }

  if (value.startsWith('::ffff:')) {
    const mappedIpv4 = value.slice('::ffff:'.length);
    if (isIP(mappedIpv4) === 4) {
      value = mappedIpv4;
    }
  }

  return isIP(value) > 0 ? value : null;
}

export function hashIp(ip: string, secret: string): string {
  return createScopedHmac(secret, `ip:${ip}`);
}

export function hashNetwork(ip: string, secret: string): string {
  return createScopedHmac(secret, `network:${toNetworkPrefix(ip)}`);
}

function toNetworkPrefix(ip: string): string {
  if (isIP(ip) === 4) {
    const octets = ip.split('.');
    return `${octets[0]}.${octets[1]}.${octets[2]}.0/24`;
  }

  const expanded = expandIpv6(ip);
  if (!expanded) return `${ip}/56`;

  const fourthHextetPrefix = `${expanded[3].slice(0, 2)}00`;
  return `${expanded[0]}:${expanded[1]}:${expanded[2]}:${fourthHextetPrefix}::/56`;
}

function expandIpv6(ip: string): string[] | null {
  if (isIP(ip) !== 6) return null;

  const [leftPart, rightPart] = ip.split('::');
  if (ip.split('::').length > 2) return null;

  const left = leftPart ? leftPart.split(':').filter(Boolean) : [];
  const right = rightPart ? rightPart.split(':').filter(Boolean) : [];
  const missing = 8 - (left.length + right.length);

  if (missing < 0) return null;

  const hextets = [
    ...left,
    ...Array.from({ length: missing }, () => '0'),
    ...right,
  ].map(part => part.padStart(4, '0'));

  return hextets.length === 8 ? hextets : null;
}

function createScopedHmac(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value).digest('hex');
}