# Arena Solo Shooter

Static browser game ready for free deployment on GitHub Pages.

## Local run

Because the project is plain HTML, CSS, and JavaScript, you can run it with any static file server.

Example:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Deploy on GitHub Pages

1. Initialize git in this folder if needed:

```bash
git init
git add .
git commit -m "Prepare GitHub Pages deployment"
```

2. Create a new GitHub repository and push this project to the `main` branch.

3. In GitHub, open `Settings -> Pages`.

4. Set `Source` to `GitHub Actions`.

5. Push to `main` again if needed. The workflow at [`.github/workflows/deploy-pages.yml`](/Users/double.d/Documents/workspace/ianFight/.github/workflows/deploy-pages.yml) will publish the game automatically.

6. After deployment, the game will be available at:

```text
https://<your-github-username>.github.io/<repository-name>/
```

## Notes

- This setup uploads only `index.html`, `game.js`, and `style.css`.
- Relative asset paths are used, so the game works on a GitHub Pages project site path.
