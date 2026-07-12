const ROLE_MAILBOX = /^mailto:[a-z0-9](?:[a-z0-9._+-]{0,62}[a-z0-9])?@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?[.])*molit[.]go[.]kr$/u;
const PUBLIC_HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?[.])+[a-z]{2,63}$/u;

function invalid(message, details = {}) {
  const error = new Error(message);
  error.code = "INVALID_PUBLIC_VALUE_POLICY";
  error.details = details;
  return error;
}

export function parsePublicValuePolicy(bytes) {
  let source;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (cause) {
    const error = new Error("public value policy must be valid UTF-8", { cause });
    error.code = "INVALID_UTF8";
    throw error;
  }

  let policy;
  try {
    policy = JSON.parse(source);
  } catch (cause) {
    throw invalid("public value policy must be valid JSON", { cause: cause.message });
  }

  const mailboxes = policy?.allowedRoleMailboxes;
  const hosts = policy?.allowedStablePublicHosts;
  const publicHosts = policy?.allowedPublicHosts;
  if (policy?.schemaVersion !== "molit.public-value-policy/1"
    || policy?.status !== "working-draft"
    || policy?.mailboxPolicy !== "exact-match-allowlist"
    || policy?.mailboxPredicate !== "http://www.w3.org/2006/vcard/ns#hasEmail"
    || policy?.contactPointPredicate !== "http://www.w3.org/ns/dcat#contactPoint"
    || policy?.contactClass !== "http://www.w3.org/2006/vcard/ns#Kind"
    || policy?.telephonePublication !== "prohibited"
    || !Array.isArray(mailboxes)
    || mailboxes.length > 100
    || mailboxes.some((value) => (
      typeof value !== "string"
        || value !== value.toLowerCase()
        || !ROLE_MAILBOX.test(value)
    ))
    || new Set(mailboxes).size !== mailboxes.length) {
    throw invalid("public value policy identity or allowlist is invalid");
  }
  if (!Array.isArray(hosts)
    || hosts.length === 0
    || hosts.length > 100
    || hosts.some((value) => (
      typeof value !== "string"
        || value !== value.toLowerCase()
        || !PUBLIC_HOST.test(value)
    ))
    || new Set(hosts).size !== hosts.length) {
    throw invalid("public stable-host allowlist is invalid");
  }
  if (!Array.isArray(publicHosts)
    || publicHosts.length === 0
    || publicHosts.length > 100
    || publicHosts.some((value) => (
      typeof value !== "string"
        || value !== value.toLowerCase()
        || !PUBLIC_HOST.test(value)
    ))
    || new Set(publicHosts).size !== publicHosts.length) {
    throw invalid("public host allowlist is invalid");
  }

  return Object.freeze({
    ...policy,
    allowedRoleMailboxes: Object.freeze([...mailboxes]),
    allowedStablePublicHosts: Object.freeze([...hosts]),
    allowedPublicHosts: Object.freeze([...publicHosts]),
  });
}
