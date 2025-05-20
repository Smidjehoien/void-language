#!/bin/bash

echo "🎩 Welcome to the Mad Hatter's Fix-Me-Up Party! 🎩"

# Step 1: Check Python version
echo "Checking your Python version..."
python --version || { echo "⚠️ Python not found! Install it first, dear wanderer!"; exit 1; }

# Step 2: Ask for env name
read -p "Enter a name for your new virtual environment: " env_name

# Step 3: Create virtual environment
echo "Creating a new virtual environment called '$env_name'..."
python -m venv "$env_name"

# Step 4: Activate it
echo "Activating the environment..."
source "$env_name/bin/activate"

# Step 5: Check for requirements.txt
if [ -f "requirements.txt" ]; then
    echo "Found requirements.txt! Attempting to install each potion carefully..."
    
    while IFS= read -r package || [[ -n "$package" ]]; do
        # Ignore empty lines and comments
        if [[ -z "$package" || "$package" == \#* ]]; then
            continue
        fi

        echo "Trying to install: $package"
        pip install "$package" || echo "⚠️ Failed to install $package... Skipping to the next potion!"
    done < requirements.txt

else
    echo "No requirements.txt found! You can install your ingredients manually."
    echo "Example: pip install flask django requests"
fi

# Step 6: List installed packages
echo "Current installed packages:"
pip list

# Step 7: Dance if successful
echo "💃🕺 Your environment is ready! Go make some magic, mighty traveler!"

