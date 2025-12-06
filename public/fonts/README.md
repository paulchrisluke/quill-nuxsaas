# Local Font Setup

This directory contains self-hosted font files for GDPR compliance, improved performance, and offline support.

## Required Font Files

The following font files should be placed in this directory:

- `lora-regular.woff2` - Lora Regular (400 weight) in WOFF2 format
- `lora-regular.woff` - Lora Regular (400 weight) in WOFF format (fallback)
- `lora-bold.woff2` - Lora Bold (700 weight) in WOFF2 format
- `lora-bold.woff` - Lora Bold (700 weight) in WOFF format (fallback)

## How to Obtain Font Files

### Option 1: Download from Google Fonts (for self-hosting)

1. Visit https://fonts.google.com/specimen/Lora
2. Click "Download family" to get the TTF files
3. Convert TTF to WOFF2/WOFF using a tool like:
   - [woff2](https://github.com/google/woff2) (command line)
   - [CloudConvert](https://cloudconvert.com/ttf-to-woff2) (online)
   - [Font Squirrel Webfont Generator](https://www.fontsquirrel.com/tools/webfont-generator)

### Option 2: Use a Font Conversion Service

1. Download Lora from Google Fonts or another source
2. Use a conversion tool to generate WOFF2 and WOFF formats
3. Place the converted files in this directory

## Font Fallbacks

The CSS includes CJK-friendly fallbacks for Chinese, Japanese, and other international characters:
- Chinese: PingFang SC, Hiragino Sans GB, Microsoft YaHei
- Japanese: Hiragino Kaku Gothic ProN, Hiragino Sans, Yu Gothic, Meiryo

These fallbacks ensure proper rendering of non-Latin characters since Lora (a serif font) may not support CJK glyphs.

## Benefits of Self-Hosting

- **GDPR Compliance**: No data sharing with Google servers
- **Performance**: Faster loading from your own CDN/server
- **Offline Support**: Works without external dependencies
- **Privacy**: No IP address logging by third parties
