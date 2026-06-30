# wled-palette

Browser editor for [WLED](https://kno.wled.ge/) color palettes. Compose
gradient stops on a live preview, pick colors with an HSV picker, and export
the result as WLED-native JSON:

```json
{"palette":[0,"2A7B9B",128,"57C785",255,"EDDD53"]}
```

Stops use WLED-native positions `0..255`. Ships with a set of example
palettes (Ocean, Sunset, Fire, Rainbow, …) to start from.

## Run

Static — open `index.html` in a browser. No build step.

Live: https://select.github.io/wled-palette/
