{
  inputs = {
    # You can override nixpkgs to use the latest set of node packages
    # nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    systems.url = "github:nix-systems/default";
  };

  outputs = {
    systems,
    nixpkgs,
    ...
  } @ inputs: let
    eachSystem = f:
      nixpkgs.lib.genAttrs (import systems) (
        system:
          f nixpkgs.legacyPackages.${system}
      );
  in {
    devShells = eachSystem (pkgs: {
      default = pkgs.mkShell {
        buildInputs = [
          pkgs.nodejs
          # You can set the major version of Node.js to a specific one instead
          # of the default version
          # pkgs.nodejs-19_x

          # You can choose pnpm, yarn, or none (npm).
          pkgs.nodePackages.pnpm
          # pkgs.yarn

          pkgs.nodePackages.typescript
          pkgs.nodePackages.typescript-language-server

          pkgs.gdal
          pkgs.postgis
        ];

        shellHook = ''
            # Run npm install and npm start in the project directory
            cd $PWD
            npm install
            npm start
        '';
      };
    });
  };
}