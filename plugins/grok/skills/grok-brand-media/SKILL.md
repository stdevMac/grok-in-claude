---
name: grok-brand-media
description: Prompt recipes for Grok image/video generation from Claude Code (OG images, README banners, launch clips)
user-invocable: true
---

# Grok brand & media recipes

Use with `/grok:image` and `/grok:video` (or companion `image` / `video` commands).

## Output conventions

- Images → `.grok-media/image/`
- Videos → `.grok-media/video/`
- Always ask Grok to print absolute paths when done

## Image recipes

### README / GitHub social banner (16:9)
```text
/grok:image --aspect 16:9 Dark developer-tool banner for "Grok in Claude". Minimal typography, abstract node graph, high contrast, no cluttered UI chrome, space for title text on the left.
```

### OG / link preview (1.91:1-ish → use 16:9)
```text
/grok:image --aspect 16:9 Open Graph image for a SaaS launch. Bold product name area, subtle grid background, one hero metaphor only.
```

### App icon concept (1:1)
```text
/grok:image --aspect 1:1 App icon concept, simple geometric mark, readable at 32px, flat with slight depth, no text.
```

### Edit existing asset
```text
/grok:image --edit ./assets/logo.png Make it monochrome, tighter padding, production-ready PNG
```

## Video recipes

### Animate a still
```text
/grok:video --image ./.grok-media/image/hero.png --duration 6 gentle camera push-in, soft parallax, premium product feel
```

### Multi-reference cutdown
```text
/grok:video --ref shot1.png --ref shot2.png --aspect 16:9 --duration 6 product launch cutdown, clean transitions, no on-screen UI clutter
```

## Prompt quality tips

- One primary subject
- Name the aspect ratio and destination (banner, icon, social)
- Say what to avoid (busy UI, tiny illegible text, watermark clutter)
- Prefer background for video: `/grok:video --background ...`
