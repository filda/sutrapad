# Jak udělat na iPhonu tlačítko „Poslat do Sutrapadu“

Tohle nastavíš **jen jednou**.

Pak už vždy jen:
**Sdílet → Send to Sutrapad**

---

## 1. Otevři Zkratky
Otevři aplikaci **Zkratky**.

## 2. Vytvoř novou zkratku
Klepni nahoře na **+**.

## 3. Pojmenuj ji
Dej jí název:

**Send to Sutrapad**

---

## 4. Zapni ji ve sdílení
Otevři **nastavení zkratky** a zapni:

- **Zobrazit v listu sdílení**
- přijímat jen **URL**

---

## 5. Přidej první krok
Přidej akci **Text**.

Do ní **nevypisuj žádná slova**.  
Jen do ní vlož proměnnou **Zkratkový vstup**.

To znamená:
- klepneš do políčka
- vybereš **Zkratkový vstup**

---

## 6. Přidej druhý krok
Přidej akci na **zakódování URL**.

Hledej něco jako:
- **Kódovat text**
- nebo **URL Encode**
- nebo **Zakódovat URL**

Tahle akce upraví odkaz tak, aby se nerozbil.

---

## 7. Přidej třetí krok
Přidej znovu akci **Text**.

Do ní napiš:

```text
https://filda.github.io/sutrapad/?url=
```

A **za to** vlož výsledek z předchozího kroku.

Takže to nebudeš psát celé ručně.  
Bude tam:
- normální text `https://filda.github.io/sutrapad/?url=`
- a za ním bublina s vloženou proměnnou

---

## 8. Přidej poslední krok
Přidej akci:

**Otevřít URL adresy**

---

# Jak se to používá

1. Otevři nějakou stránku v Safari
2. Klepni na **Sdílet**
3. Vyber **Send to Sutrapad**
4. Otevře se Sutrapad s tím odkazem

---

# Když zkratka není vidět
Ve sdílecí nabídce sjeď dolů a zkus:
- **Upravit akce**
- přidat **Send to Sutrapad**

---

# Důležitá věc
Do zkratky se **nepíše ručně** něco jako `[Zkratkový vstup]`.

Musí se tam **vložit proměnná** jako bublina.

---

# Jak mají jít kroky za sebou

Ve výsledku tam mají být 4 kroky:

1. **Text** → obsahuje proměnnou **Zkratkový vstup**
2. **Zakódovat text / URL**
3. **Text** → `https://filda.github.io/sutrapad/?url=` + vložený zakódovaný výsledek
4. **Otevřít URL adresy**
