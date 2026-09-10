#!/usr/bin/env python3

# Copyright (c) 2026, Sabino.
# SPDX-License-Identifier: BSD-2-Clause

"""Install this personal fork and its vcpkg runtime libraries without root."""

import argparse
import os
import shutil
import subprocess
import sys

from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--build-dir", type=Path, default=Path("Build/release"))
    parser.add_argument("--prefix", type=Path, required=True)
    args = parser.parse_args()
    if not sys.platform.startswith("linux"):
        parser.error("This installer is for the Linux build of the personal fork.")

    build = args.build_dir.expanduser().resolve()
    prefix = args.prefix.expanduser().resolve()
    if not (build / "bin/Ladybird").is_file():
        parser.error("Build the Ladybird target before installing.")
    if prefix == build or prefix.is_relative_to(build):
        parser.error("Choose an installation prefix outside the build directory.")
    if prefix.exists() and (not prefix.is_dir() or any(prefix.iterdir())):
        parser.error("Choose a new, empty directory so a running installation is not overwritten.")

    cache = {}
    for line in (build / "CMakeCache.txt").read_text().splitlines():
        if line.startswith(("#", "//")) or "=" not in line:
            continue
        key, value = line.split("=", 1)
        cache[key.split(":", 1)[0]] = value
    installed = Path(cache.get("VCPKG_INSTALLED_DIR", str(build / "vcpkg_installed")))
    dependencies = installed / cache["VCPKG_TARGET_TRIPLET"]
    if not (dependencies / "lib").is_dir():
        parser.error("Cannot find the vcpkg runtime libraries for this build.")

    subprocess.run(
        ["cmake", "--install", str(build), "--component", "ladybird_Runtime", "--strip", "--prefix", str(prefix)],
        check=True,
    )

    # Preserve the shared-library SONAME links, including provider subdirectories.
    # Use a fresh prefix for an update so currently running processes retain their
    # complete old runtime until the browser is restarted.
    source_lib = dependencies / "lib"
    libraries = sorted(path for path in source_lib.rglob("*.so*") if path.is_file())
    for source in libraries:
        destination = prefix / "lib" / source.relative_to(source_lib)
        destination.parent.mkdir(parents=True, exist_ok=True)
        if source.is_symlink():
            target = prefix / "lib" / source.resolve().relative_to(source_lib.resolve())
            destination.unlink(missing_ok=True)
            destination.symlink_to(os.path.relpath(target, destination.parent))
        else:
            shutil.copy2(source, destination)

    if (dependencies / "etc/ssl").is_dir():
        shutil.copytree(dependencies / "etc/ssl", prefix / "etc/ssl", dirs_exist_ok=True)
    # Keep configuration matched to the bundled Fontconfig version and within
    # the resource fonts directory that sandboxed helper processes can read.
    if (dependencies / "etc/fonts").is_dir():
        fontconfig = prefix / "share/Lagom/fonts/fontconfig"
        shutil.copytree(dependencies / "etc/fonts", fontconfig, dirs_exist_ok=True)
        config = fontconfig / "fonts.conf"
        config.write_text(
            config.read_text().replace(
                "<dir>/usr/share/fonts</dir>", '<dir prefix="relative">..</dir>\n\t<dir>/usr/share/fonts</dir>'
            )
        )
    licenses = prefix / "share/licenses/ladybird-native"
    licenses.mkdir(parents=True, exist_ok=True)
    shutil.copy2(Path(__file__).resolve().parent.parent / "LICENSE", licenses / "LICENSE")
    for source in (dependencies / "share").glob("*/copyright"):
        destination = licenses / "vcpkg" / source.parent.name / "copyright"
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)

    launcher = prefix / "bin/ladybird-native"
    launcher.write_text("""#!/bin/sh
set -eu
LADYBIRD_NATIVE_ROOT=$(dirname "$(dirname "$(readlink -f "$0")")")
LADYBIRD_CERT_BUNDLE=$(readlink -f /etc/ssl/cert.pem)
if [ ! -r "$LADYBIRD_CERT_BUNDLE" ]; then
    printf '%s\\n' 'Ladybird: the system certificate bundle could not be found.' >&2
    exit 1
fi
export LD_LIBRARY_PATH="$LADYBIRD_NATIVE_ROOT/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export FONTCONFIG_PATH="${FONTCONFIG_PATH:-$LADYBIRD_NATIVE_ROOT/share/Lagom/fonts/fontconfig}"
export FONTCONFIG_FILE="${FONTCONFIG_FILE:-$LADYBIRD_NATIVE_ROOT/share/Lagom/fonts/fontconfig/fonts.conf}"
if [ -f "$LADYBIRD_NATIVE_ROOT/etc/ssl/openssl.cnf" ]; then
    export OPENSSL_CONF="${OPENSSL_CONF:-$LADYBIRD_NATIVE_ROOT/etc/ssl/openssl.cnf}"
fi
if [ -d "$LADYBIRD_NATIVE_ROOT/lib/ossl-modules" ]; then
    export OPENSSL_MODULES="${OPENSSL_MODULES:-$LADYBIRD_NATIVE_ROOT/lib/ossl-modules}"
fi
exec "$LADYBIRD_NATIVE_ROOT/bin/Ladybird" --certificate "$LADYBIRD_CERT_BUNDLE" "$@"
""")
    launcher.chmod(0o755)
    print(f"Installed Ladybird and {len(libraries)} vcpkg library files to {prefix}")
    print(f"Launch with: {launcher}")


if __name__ == "__main__":
    main()
