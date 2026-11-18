{ pkgs, ... }: {
  channel = "stable-24.05";

  packages = [
    pkgs.nodejs_20
    pkgs.postgresql_16
  ];

  services.docker.enable = true;

  env = {
    PORT = "3001";
    VITE_API_BASE_URL = "http://localhost:3001/api";
  };

  idx = {
    extensions = [
      "Vue.volar"
    ];

    workspace = {
      onCreate = {
        npm-install = "npm install";
      };
      onStart = {
        start-backend = "npm run dev:backend";
      };
    };

    previews = {
      enable = true;
      previews = {
        web = {
          command = ["npm" "run" "dev:frontend" "--" "--port" "$PORT" "--host" "0.0.0.0"];
          manager = "web";
        };
      };
    };
  };
}
