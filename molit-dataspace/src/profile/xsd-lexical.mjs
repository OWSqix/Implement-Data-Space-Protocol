const XSD = "http://www.w3.org/2001/XMLSchema#";

function validTimezone(value, required = false) {
  if (!value) return !required;
  if (value === "Z") return true;
  const match = value.match(/^[+-](\d{2}):(\d{2})$/u);
  if (!match) return false;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return minutes <= 59 && (hours < 14 || (hours === 14 && minutes === 0));
}

function leapYear(year) {
  return year % 4n === 0n && (year % 100n !== 0n || year % 400n === 0n);
}

function validCalendarDate(yearText, monthText, dayText) {
  let year;
  try {
    year = BigInt(yearText);
  } catch {
    return false;
  }
  const month = Number(monthText);
  const day = Number(dayText);
  if (year === 0n) return false;
  if (month < 1 || month > 12 || day < 1) return false;
  const monthLengths = [31, leapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= monthLengths[month - 1];
}

function validDate(value) {
  const match = value.match(/^(-?(?:[1-9]\d{3,}|0\d{3}))-(\d{2})-(\d{2})(Z|[+-]\d{2}:\d{2})?$/u);
  return Boolean(match
    && validCalendarDate(match[1], match[2], match[3])
    && validTimezone(match[4]));
}

function validDateTime(value, timezoneRequired = false) {
  const match = value.match(
    /^(-?(?:[1-9]\d{3,}|0\d{3}))-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})([.]\d+)?(Z|[+-]\d{2}:\d{2})?$/u,
  );
  if (!match || !validCalendarDate(match[1], match[2], match[3])) return false;
  const hours = Number(match[4]);
  const minutes = Number(match[5]);
  const seconds = Number(match[6]);
  const fractional = match[7]?.slice(1) ?? "";
  const endOfDay = hours === 24
    && minutes === 0
    && seconds === 0
    && (!fractional || /^0+$/u.test(fractional));
  return (hours <= 23 || endOfDay)
    && minutes <= 59
    && seconds <= 59
    && validTimezone(match[8], timezoneRequired);
}

function validDuration(value) {
  const match = value.match(
    /^-?P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:[.]\d+)?)S)?)?$/u,
  );
  if (!match) return false;
  const hasDatePart = match.slice(1, 4).some((part) => part !== undefined);
  const hasTimePart = match.slice(4, 7).some((part) => part !== undefined);
  if (!hasDatePart && !hasTimePart) return false;
  if (value.includes("T") && !hasTimePart) return false;
  return true;
}

const validators = new Map([
  [`${XSD}boolean`, (value) => /^(?:true|false|0|1)$/u.test(value)],
  [`${XSD}date`, validDate],
  [`${XSD}dateTime`, (value) => validDateTime(value)],
  [`${XSD}dateTimeStamp`, (value) => validDateTime(value, true)],
  [`${XSD}decimal`, (value) => /^[+-]?(?:\d+(?:[.]\d*)?|[.]\d+)$/u.test(value)],
  [`${XSD}double`, (value) => /^(?:-?INF|NaN|[+-]?(?:\d+(?:[.]\d*)?|[.]\d+)(?:[eE][+-]?\d+)?)$/u.test(value)],
  [`${XSD}duration`, validDuration],
  [`${XSD}float`, (value) => /^(?:-?INF|NaN|[+-]?(?:\d+(?:[.]\d*)?|[.]\d+)(?:[eE][+-]?\d+)?)$/u.test(value)],
  [`${XSD}hexBinary`, (value) => /^(?:[0-9A-Fa-f]{2})*$/u.test(value)],
  [`${XSD}integer`, (value) => /^[+-]?\d+$/u.test(value)],
  [`${XSD}negativeInteger`, (value) => /^-\d+$/u.test(value) && !/^-0+$/u.test(value)],
  [`${XSD}nonNegativeInteger`, (value) => /^[+]?\d+$/u.test(value) || /^-0+$/u.test(value)],
  [`${XSD}nonPositiveInteger`, (value) => /^-\d+$/u.test(value) || /^[+]?0+$/u.test(value)],
  [`${XSD}positiveInteger`, (value) => /^[+]?\d+$/u.test(value) && !/^[+]?0+$/u.test(value)],
  // UTF-8 decoding and the RDF parser have already established a Unicode
  // lexical form. xsd:string adds no narrower lexical or value-space facet.
  [`${XSD}string`, () => true],
]);

export function validateSupportedXsdLiteral(term) {
  if (term?.termType !== "Literal") return null;
  const datatype = term.datatype?.value;
  const validate = validators.get(datatype);
  if (!validate) {
    if (!datatype?.startsWith(XSD)) return null;
    return {
      datatype,
      reason: "unsupported-xsd-datatype",
      valid: false,
    };
  }
  const valid = validate(term.value);
  return {
    datatype,
    reason: valid ? null : "invalid-lexical-or-value-space",
    valid,
  };
}

export const supportedXsdDatatypes = Object.freeze([...validators.keys()].sort());
