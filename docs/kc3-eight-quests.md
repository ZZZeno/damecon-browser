# KC3Kai horizontal panel: eight quests

In KC3Kai, open **Settings → Natsuiro → Custom CSS**, paste the contents of `kc3-eight-quests.css`, and save.

The override adds 18px to the compact horizontal wrapper (450px → 468px) and quest module (126px → 144px), allowing eight 18px quest rows with existing padding.

To revert, remove the two CSS declarations from Custom CSS and save:

```css
.wrapper.h {
  height: 468px;
}
.h .module.quests {
  height: 144px;
}
```
