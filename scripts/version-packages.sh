#!/bin/bash
npx changeset version
git commit --amend -m "Version Packages" --no-verify || true
