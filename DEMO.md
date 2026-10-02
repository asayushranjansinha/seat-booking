# Running a client demo

Everything below is 15 minutes if you talk, 5 if you rush. The point of the demo is one
sentence, so say it early and then prove it:

> **Most seat-booking tools ship a fixed grid of seats. Here the admin draws the building,
> and the seats behave parametrically — move or resize a table and the seats follow.**

---

## 0. Before the client joins (2 minutes)

```bash
cd ~/Desktop/seat-booking
docker compose up -d                                   # postgres · redis · mailpit
cd apps/api && mvn spring-boot:run                     # :8080  — wait for "Demo floor published"
cd apps/web && npm run dev                             # :3000
```

Open **http://localhost:3000** and sign in as `admin@demo.test` / `password`.

The sign-in page lists every account that exists and fills the form when you click one,
so switching between an admin, a manager and a colleague mid-demo costs nothing. Run
`./tools/add-people.sh` first if you want a crowd rather than three people.

**Reset to a clean demo at any time** — do this between runs, it takes 25 seconds:

```bash
./tools/demo-reset.sh
```

Check these before you share your screen:

- The plan shows **3 rooms, 4 tables, 27 seats** (right-hand panel).
- Badge top-left reads **Published · rev 2**.
- Have **http://localhost:8025** open in a second tab — that is Mailpit, the fake inbox.

---

## 1. The floor you are given (1 min)

Point at the three rooms and say what each one is for. This is the setup for everything
after it:

| Room | Shape | Why it is there |
| --- | --- | --- |
| Open Studio | Rectangle, 12 × 8 m | Two benches, a door, an emergency exit, one partition |
| Round Room | Circle, r = 4 m | A round table with radial seating |
| The Annex | L-shaped polygon | A triangular table — proves "any shape" is not marketing |

> "Three different room shapes, three different table shapes. One piece of code places the
> seats around all of them."

---

## 2. The headline: resize a table (2 min) — **the moment that sells it**

1. Click **Edit layout** (top right). A private draft is created — nothing you do now is
   visible to anyone until you publish.
2. Click **Bench A**, the rectangular table on the left of the Open Studio.
3. In the right panel, drag **Width** from 2.4 up to about 4.5.

**Watch the seats.** Three along the top and three along the bottom spread out to match
the new table; the end seats move out to the new ends. Nothing was repositioned by hand.

> "Every seat stores where it sits *relative to its table*, not where it sits on the
> floor. So the table is the only thing that changed."

**Then rotate it.** Drag the **Rotation** slider, or grab the amber grip above the table
on the canvas. The whole table and all eight seats turn together.

> "That is one number changing. No seat record was touched."

**Undo it** (Cmd-Z) before moving on.

---

## 3. Manual control without losing the rule (1 min)

1. Drag any single seat away from its table.
2. It turns **amber** — pinned where you put it — and the others redistribute around it.
3. Select it and press **Unpin and let the rule place it**.

> "The usual trade-off is automatic placement *or* manual control. Here you get both: drag
> one seat and only that seat stops obeying the rule."

---

## 4. Drawing a room from nothing (2 min)

Use the **pen** (third icon down the left rail).

1. Click each corner of an L-shape in empty space — six clicks.
2. Click the **first corner again** to close it.

Then with the room selected, add a table: click the **rectangular table** icon, then click
inside your new room. Eight seats appear around it immediately.

> "No templates, no fixed grid. Arbitrary rooms, and the seating rules work on whatever
> you draw."

---

## 5. Doors and partitions, and the zones they create (2 min)

1. **Door icon** → click any wall of the Open Studio. The door sits *on* the wall.
2. **Partition icon** → click one wall, then the opposite one.
3. Select the room. The panel shows **Zones created by the partitions**, e.g.
   `Zone A · 48.0 m²` and `Zone B · 48.0 m²`.

> "You drew a line. The system worked out that it divides the room into two areas and how
> big each one is. Resize the room and those numbers follow."

A partition that stops short of the far wall correctly divides nothing — worth mentioning
if someone asks how robust it is.

---

## 6. It refuses to publish something broken (2 min) — **the credibility moment**

1. Drag a seat through a wall until it is outside its room. It turns **red**.
2. Press **Publish**.

Publishing is refused, and a bar appears at the bottom: *"Seat 'A8' is outside its room."*
Click the message — it selects the offending seat.

> "The browser checks this for instant feedback, but the server checks it again before
> publishing, because a browser can be lied to."

Fix it (Cmd-Z), press **Publish** again, and it goes live.

---

## 7. The 3D view (30 seconds)

Press the **cube icon** in the top bar. The rooms extrude into walls you can orbit around.

> "Same outline as the 2D plan — literally the same data, extruded. The 3D view cannot
> drift from the plan, because there is no second copy of the layout."

---

## 8. Booking, and why there is a time scrubber (2 min)

Switch to **Book** (top centre).

1. Drag the **When** slider. Nothing changes yet — 27 seats free.
2. Click a seat → the card shows the price for the window. Press **Book this seat**.
3. The seat turns **blue**, the counts update, a toast confirms it.
4. Now **drag the When slider forward a few hours**. The seat is **green again**.

> "A seat is not free or booked. It is free or booked *at a time*. That is why the colour
> comes from the window you are looking at and is never stored on the seat."

---

## 9. Two people, one seat (1 min) — **the engineering moment**

In a terminal, while the client watches your browser:

```bash
./tools/demo-race.sh
```

That fires 16 simultaneous booking requests at a single seat. The result is always
**1 accepted, 15 refused**, and your browser updates live without a reload.

> "The database decides this, not the application. Both requests genuinely reach Postgres
> and an exclusion constraint admits exactly one. There is no lock to get wrong."

If someone is technical, add: *"We prove it by removing the constraint — then all 16
succeed and the seat is booked sixteen times over."*

---

## 10. Meetings and real invitations (2 min)

Sign out, sign in as **manager@demo.test** / `password`. Go to **Book → Meet**.

1. Click the **Round Table** on the plan.
2. Give it a title, add two email addresses, press **Hold all 6 seats**.
3. Switch to your **Mailpit tab** (http://localhost:8025) — two invitations are there,
   each with a real `invite.ics` attachment.
4. Open one, copy the **Accept** link, paste it into a new tab. Accept it.
5. Back in **Meet**, the invitee now shows **accepted**.

> "Those are real calendar invitations — Outlook and Google will offer Accept and Decline.
> And the invitee needed no account at all."

Worth saying: *"The email is written in the same transaction as the booking, then sent
separately. So the mail server can never slow down a booking or lose an invitation."*

---

## Questions you will get

**"What if two admins edit at once?"**
The second save is refused with a clear message rather than overwriting the first.
Demo it by opening two tabs, editing in both, saving the second.

**"What happens to bookings when we change a layout?"**
Publishing is refused if it would delete a seat somebody has booked, and it tells you who
and when. Otherwise bookings follow their seat onto the new version automatically.

**"Can rooms be any shape?"**
Rectangles, circles, ellipses and arbitrary polygons today. Curved (bezier) walls are
designed for but deliberately not built yet.

**"How many floors / buildings?"**
The data model handles many; the UI currently ships one seeded floor. Managing buildings
and floors is the next piece of work — say so plainly, it is a small gap, not a redesign.

**"Is it multi-tenant?"**
Yes — every table carries an organisation from day one.

---

## If something goes wrong mid-demo

| Symptom | Fix |
| --- | --- |
| Canvas is blank | Reload the page. If still blank, check `:8080` is up. |
| **Whole page blank/white** | The dev build cache is corrupt. `cd apps/web && npm run clean && npm run dev`. Usually caused by running `next build` while `next dev` is live — use `npm run build:check` instead. |
| "This floor has no published layout" | `./tools/demo-reset.sh` |
| Publish refused unexpectedly | Press **Check** — the bar at the bottom lists exactly what is wrong. |
| Emails not arriving | `docker compose ps` — Mailpit must be running. |
| Everything is odd | `./tools/demo-reset.sh` and reload. 25 seconds. |

**Never demo on a draft you have been poking at.** Reset first.

---

## Newer things worth showing

These came after the script above and are not woven into it. Each is one minute.

**Build a row in three moves.** Draw one table. `⌘D` duplicates it clear of the original.
Sweep a box over both, `⌘C`, `⌘V` — the pair lands where the pointer is with its spacing
intact. Then select the row and press **Space evenly**: every gap becomes the same,
*including the floor against each wall*, measured on the tables **and their chairs**
because the chairs are what collide.

> This is the part that reads as a real tool rather than a diagram editor.

**One desk per person.** Sign in as Priya, book a desk, then try a second seat that
overlaps in time. The refusal comes from a database constraint, not a check in the code —
so it holds when two requests race. Say that out loud; it is the same reason the seat
itself cannot be double-booked.

**Call cabins.** In Plan, set a room's purpose to *Call cabin*. It tints on the plan. Now
sign in as an ordinary user and try to book a seat in it: refused by the server, not by a
hidden button. Nina or Omar (managers) can.

**The plan is to scale.** Press `0` to frame the floor, pinch to zoom into a doorway. The
walls have thickness, the door has its swing arc, and the 3D view is built from the same
numbers — so switching views cannot show you a different building.

**Deleting.** Everything on the plan answers to a click now, including partitions and
doors. Select a partition and delete it: the zones either side merge back into one, and
the tables stay exactly where they were.

## What to say when they ask "how do I add my staff?"

They will ask. The honest answer today is that you cannot from the product — accounts are
created by a script against the database. It is the next thing to build, and it is better
to say so than to be found out live.
