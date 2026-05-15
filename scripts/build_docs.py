"""
Concatenates docs/*.md files into DOCUMENTATION.md based on docs/_order.yml.
Keeps the single-file version in sync with the multi-file docs/ source.
Converts relative MkDocs links to anchor links for the single-file output.

Usage: python scripts/build_docs.py
"""

import yaml
import os
import re

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.join(SCRIPT_DIR, '..')
DOCS_DIR = os.path.join(ROOT_DIR, 'docs')
OUTPUT = os.path.join(ROOT_DIR, 'DOCUMENTATION.md')


def make_anchor(heading_text):
    """Convert heading text to GitHub-style anchor."""
    anchor = heading_text.lower().strip()
    anchor = re.sub(r'[^\w\s-]', '', anchor)
    anchor = re.sub(r'\s+', '-', anchor)
    return anchor


def build_heading_map(all_content):
    """Build a map of file paths to the first heading anchor in that file."""
    heading_map = {}
    for filepath, content in all_content:
        match = re.search(r'^#+\s+(.+)$', content, re.MULTILINE)
        if match:
            heading_map[filepath] = '#' + make_anchor(match.group(1))
    return heading_map


def convert_links(content, current_file, heading_map):
    """Convert relative file links like [text](../path/file.md) to anchor links."""
    def replace_link(match):
        text = match.group(1)
        target = match.group(2)
        # Skip external links and already-anchor links
        if target.startswith('http') or target.startswith('#'):
            return match.group(0)
        # Resolve relative path
        current_dir = os.path.dirname(current_file)
        resolved = os.path.normpath(os.path.join(current_dir, target)).replace('\\', '/')
        # Look up in heading map
        if resolved in heading_map:
            return f'[{text}]({heading_map[resolved]})'
        return match.group(0)

    return re.sub(r'\[([^\]]+)\]\(([^)]+)\)', replace_link, content)


with open(os.path.join(DOCS_DIR, '_order.yml'), encoding='utf-8') as f:
    order = yaml.safe_load(f)

# First pass: read all content
all_content = []
for page in order:
    filepath = os.path.join(DOCS_DIR, page)
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    all_content.append((page, content))

# Build heading map
heading_map = build_heading_map(all_content)

# Second pass: write with converted links
with open(OUTPUT, 'w', encoding='utf-8') as out:
    for i, (page, content) in enumerate(all_content):
        content = convert_links(content, page, heading_map)
        out.write(content)
        if i < len(all_content) - 1:
            if not content.endswith('\n'):
                out.write('\n')
            out.write('\n')

print(f"Built DOCUMENTATION.md from {len(order)} files")
