<div style="text-align: center;">
	<img src="/logo.svg" height="150"/>
</div>

## Install
```bash
npm i deerycs
```

## Usage
### Terminal
```bash
node index.js 'music_id_on_deezer'
```
### NodeJS
```javascript
const deerycs = require('deerycs')

async function main() {
	await deerycs.generateLrc('music_id_on_deezer')
}

main()
```