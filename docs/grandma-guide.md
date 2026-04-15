# How to make a “Send to SutraPad” button on iPhone

You only set this up **once**.

After that, you will always just use:
**Share → Send to SutraPad**

---

## 1. Open Shortcuts
Open the **Shortcuts** app.

## 2. Create a new shortcut
Tap the **+** in the top right corner.

## 3. Name it
Call it:

**Send to SutraPad**

---

## 4. Turn it on in the Share Sheet
Open the **shortcut settings** and turn on:

- **Show in Share Sheet**
- accept only **URLs**

---

## 5. Add the first step
Add the **Text** action.

Do **not** type any words into it.  
Just insert the **Shortcut Input** variable.

That means:
- tap into the field
- choose **Shortcut Input**

---

## 6. Add the second step
Add an action for **URL encoding**.

Search for something like:
- **URL Encode**
- **Encode Text**
- **Encode URL**

This action fixes the link so it does not break.

---

## 7. Add the third step
Add the **Text** action again.

Type this into it:

```text
https://filda.github.io/sutrapad/?url=
```

And **after that**, insert the result from the previous step.

So you do **not** type the whole thing by hand.  
It should contain:
- normal text `https://filda.github.io/sutrapad/?url=`
- and after it a variable bubble with the encoded result

---

## 8. Add the last step
Add this action:

**Open URLs**

---

# How to use it

1. Open a page in Safari
2. Tap **Share**
3. Choose **Send to SutraPad**
4. SutraPad opens with that link

---

# If the shortcut is not visible
In the Share Sheet, scroll down and try:
- **Edit Actions**
- add **Send to SutraPad**

---

# Important thing
Do **not** type something like `[Shortcut Input]` by hand into the shortcut.

You must **insert the variable** as a bubble.

---

# What the steps should look like

In the end there should be 4 steps:

1. **Text** → contains the **Shortcut Input** variable
2. **Encode Text / URL**
3. **Text** → `https://filda.github.io/sutrapad/?url=` + the inserted encoded result
4. **Open URLs**
