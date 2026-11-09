#!/usr/bin/env python3
"""Rebuild supabase/demo-cloud-setup.sql (the one-time setup of the hosted DEMO project) from its sources:
migrations 0500 onwards, demo-data.sql, demo-live.sql, demo-membership.sql, and the demo staff accounts section
already in the file (it holds only a bcrypt hash of the demo password, which is not kept anywhere in the repo).
Usage: python3 scripts/build-demo-cloud.py   (from hemshech-tnua/)
"""
from pathlib import Path

root = Path(__file__).resolve().parent.parent / 'supabase'
out = root / 'demo-cloud-setup.sql'
old = out.read_text()

header = old[: old.index('-- ===== migration ')]
staff = old[old.index('-- ===== demo staff accounts ====='):]

parts = [header]
for m in sorted((root / 'migrations').glob('*.sql')):
    if m.stem < '20261106000500':
        continue  # 0100-0400 are applied as migrations before this file runs
    parts.append(f'-- ===== migration {m.stem} =====\n{m.read_text()}\n')
parts.append(f"-- ===== demo data (fictitious) =====\n{(root / 'demo-data.sql').read_text()}\n")
parts.append(f"-- ===== demo: a meeting open for check-in now =====\n{(root / 'demo-live.sql').read_text()}\n")
parts.append(f"-- ===== demo: association membership =====\n{(root / 'demo-membership.sql').read_text()}\n")
parts.append(staff)
out.write_text(''.join(parts))
print(f'wrote {out} ({sum(p.count(chr(10)) for p in parts)} lines)')
