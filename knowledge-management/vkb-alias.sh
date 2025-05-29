#!/bin/bash
# Add this alias to your shell configuration

# For bash (~/.bashrc or ~/.bash_profile)
echo 'alias vkb="~/vkb"' >> ~/.bashrc

# For zsh (~/.zshrc) - which is default on macOS
echo 'alias vkb="~/vkb"' >> ~/.zshrc

# Source the file to make it available immediately
source ~/.zshrc 2>/dev/null || source ~/.bashrc 2>/dev/null

echo "✓ Alias 'vkb' added to your shell configuration"
echo "You can now use 'vkb' from anywhere in the terminal"
echo "Or use '!vkb' from Claude"