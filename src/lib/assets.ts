export interface Asset {
  code: string;
  issuer: string;
  isNative?: boolean;
}

/**
 * Example helper to create an Asset from a string like "USD*G...".
 */
export function parseAsset(str: string): Asset {
  if (str === "XLM") {
    return { code: "XLM", issuer: "", isNative: true };
  }
  const [code, issuer] = str.split("*");
  return { code, issuer };
}
