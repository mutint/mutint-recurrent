"""The version of mutint-recurrent itself.

An installed app contributes a version by exposing `__version__` from a `version` submodule;
`./mutint version` finds it that way, and `/about` does not, which is why apps.py passes it to
`register_about_section` as well. `NAME` is what `./mutint version` prints and what
`--component` matches. Bump with `./mutint version --bump patch --component mutint-recurrent`
and tag the release commit `v<version>`.
"""

NAME = "mutint-recurrent"

__version__ = "0.0.1"
