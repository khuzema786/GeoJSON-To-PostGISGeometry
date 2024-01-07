# location-tracking-service

## Setting up development environment

### Nix

1. [Install **Nix**](https://github.com/DeterminateSystems/nix-installer#the-determinate-nix-installer)
    - If you already have Nix installed, you must [enable Flakes](https://nixos.wiki/wiki/Flakes#Enable_flakes) manually.
    - Then, run the following to check that everything is green ✅.
        ```sh
        nix run nixpkgs#nix-health
        ```
1. [Optional] Setup the Nix **binary cache**:
    ```sh
    nix run nixpkgs#cachix use nammayatri
    ```
    - For this command to succeed, you must have added yourself to the `trusted-users` list of `nix.conf`
1. Install **home-manager**[^hm] and setup **nix-direnv** and **starship** by following the instructions [in this home-manager template](https://github.com/juspay/nix-dev-home).[^direnv] [You want this](https://haskell.flake.page/direnv) to facilitate a nice Nix develoment environment.

[^hm]: Unless you are using NixOS in which case home-manager is not strictly needed.
[^direnv]: Not strictly required to develop the project. If you do not use `direnv` however you would have to remember to manually restart the `nix develop` shell, and know when exactly to do this each time.

## Usage / Installing

1. Add the KML file to the `assets/kml` directory.
2. Add the KML related information to the `assets/special-zones.xlsx` with locationName being same as `assets/kml/<filename>.kml`.
3. In `kml_to_pgsl.js`, 
   - `typeOfMigration` can be updated to UPDATE or INSERT based on the type of SQL queries that needs to be generated.
   - `sheet` corresponds to zero index based excel sheet.
   - `farePolicy` is used to generate Fare Product link queries for the special zones.
4. Run `nix develop` in the root directory to build and run the script.