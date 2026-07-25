export function releaseVersions(tags) {
  return tags.flatMap((tag) => {
    const match = /^v[\s-]?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)$/i.exec(tag.trim());
    return match ? [match[1]] : [];
  });
}

export function tagsByCommit(tags) {
  const result = new Map();
  for (const tag of tags) {
    const current = result.get(tag.sha) ?? [];
    current.push(tag.name);
    result.set(tag.sha, current);
  }
  return result;
}
