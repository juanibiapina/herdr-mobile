{
  description = "Herdr Mobile Android development and local builds";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { nixpkgs, ... }:
    let
      systems = [ "aarch64-darwin" "x86_64-linux" ];
    in {
      devShells = nixpkgs.lib.genAttrs systems (system:
        let
          pkgs = import nixpkgs {
            inherit system;
            config = {
              allowUnfree = true;
              android_sdk.accept_license = true;
            };
          };
          android = pkgs.androidenv.composeAndroidPackages {
            platformVersions = [ "36" ];
            buildToolsVersions = [ "35.0.0" "36.0.0" ];
            includeNDK = true;
            # Expo Updates uses AGP's default NDK; React Native pins a newer one.
            ndkVersions = [ "27.0.12077973" "27.1.12297006" ];
            includeCmake = true;
            cmakeVersions = [ "3.22.1" ];
          };
          sdk = "${android.androidsdk}/libexec/android-sdk";
        in {
          default = pkgs.mkShell {
            packages = [
              pkgs.nodejs_22
              pkgs.pnpm_10
              pkgs.jdk17
              pkgs.android-tools
              pkgs.scrcpy
              android.androidsdk
            ];

            JAVA_HOME = "${pkgs.jdk17.home}";
            ANDROID_HOME = sdk;
            ANDROID_SDK_ROOT = sdk;
          };
        });
    };
}
