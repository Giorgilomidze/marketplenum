"""Release a tested app from the test site (solvephantasma.com) to Marketplenum (MKT-10).

Owner, 20 Nov 2026: solvephantasma.com stays the TEST site for the Advertising platform and
Marketplace automation; marketplenum.com is the LIVE site. A release copies what is live on the
test site, unchanged, into this repo.

Usage:
    python "D:\\Web Development\\Marketplenum\\tools\\release.py" ads
    python "D:\\Web Development\\Marketplenum\\tools\\release.py" ecommerce
    python "D:\\Web Development\\Marketplenum\\tools\\release.py" shared

- Copies the app folder exactly as committed in the website repo (its HEAD must equal origin/main,
  i.e. what solvephantasma.com shows), plus the two shared files styles.css and career.js (every
  release takes them along, so the app runs here with the same versions it was tested with).
- Mirrors the folder: a file deleted at the source is deleted here. Local test pages (_harness*)
  never come along.
- Prints what changed. It does not commit or push: the session does that after the owner's "push"
  (take the Marketplenum push lock in the library's SESSIONS.md first).

Never edit released files in this repo: change them on the test site, push there, release again.
This script lives in tools/, which _config.yml keeps off the live site.
"""
import os
import subprocess
import sys

SOURCE = r"D:\Web Development\Solve Phantasma web page development"
TARGET = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # this Marketplenum repo
APPS = {"ads": "campaigns", "ecommerce": "ecommerce"}
SHARED = ["styles.css", "career.js"]


def git(*args):
    return subprocess.run(["git", "-C", SOURCE] + list(args), capture_output=True, check=True).stdout


def main():
    what = sys.argv[1] if len(sys.argv) == 2 else ""
    if what not in list(APPS) + ["shared"]:
        sys.exit("usage: release.py ads | ecommerce | shared")

    head = git("rev-parse", "HEAD").decode().strip()
    origin = git("rev-parse", "origin/main").decode().strip()
    if head != origin:
        sys.exit("Stop: the website repo HEAD (%s) is not origin/main (%s). "
                 "Release only what is live on the test site." % (head[:7], origin[:7]))

    folder = APPS.get(what)
    paths = list(SHARED)
    if folder:
        paths += [p for p in git("ls-files", folder).decode().splitlines()
                  if not os.path.basename(p).startswith("_harness")]

    added, changed, same = [], [], 0
    for p in paths:
        data = git("show", "HEAD:" + p)
        dst = os.path.join(TARGET, *p.split("/"))
        old = open(dst, "rb").read() if os.path.exists(dst) else None
        if old == data:
            same += 1
            continue
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        with open(dst, "wb") as f:
            f.write(data)
        (changed if old is not None else added).append(p)

    removed = []
    if folder:
        keep = {os.path.normcase(os.path.normpath(os.path.join(TARGET, *p.split("/")))) for p in paths}
        for root, _, files in os.walk(os.path.join(TARGET, folder)):
            for name in files:
                full = os.path.normpath(os.path.join(root, name))
                if os.path.normcase(full) not in keep and not name.startswith("_harness"):
                    os.remove(full)
                    removed.append(os.path.relpath(full, TARGET))

    print("Released %s from the test site (%s): %d added, %d changed, %d removed, %d unchanged."
          % (what, head[:7], len(added), len(changed), len(removed), same))
    for label, items in (("added", added), ("changed", changed), ("removed", removed)):
        for p in items:
            print("  %-8s %s" % (label, p))


if __name__ == "__main__":
    main()
