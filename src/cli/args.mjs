export function readFlag(args, name) {
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

export function hasFlag(args, name) {
  return args.includes(`--${name}`);
}
