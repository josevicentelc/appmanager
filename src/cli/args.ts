export function readFlag(args: string[], name: string): string | null {
  const index = args.indexOf(`--${name}`);
  if (index === -1) {
    return null;
  }

  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing value for --${name}`);
  }

  return value;
}

export function hasFlag(args: string[], name: string): boolean {
  return args.includes(`--${name}`);
}
