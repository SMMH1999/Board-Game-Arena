"""Original benchmark card fixtures, in the reader's C/S/E/R/O color order."""

# Each template is (prestige, costs relative to the bonus color). Rotate each
# through the five bonus colors so that initial market supply has no color bias.
CARD_TEMPLATES = (
    (
        (0, (0, 2, 1, 1, 0)),
        (0, (0, 0, 2, 1, 1)),
        (0, (0, 1, 0, 2, 2)),
        (0, (0, 1, 2, 0, 2)),
        (0, (1, 1, 0, 1, 1)),
        (0, (0, 3, 1, 0, 0)),
        (0, (0, 0, 0, 3, 0)),
        (1, (0, 0, 4, 0, 0)),
    ),
    (
        (1, (0, 3, 2, 1, 0)),
        (1, (0, 0, 2, 3, 2)),
        (2, (0, 4, 0, 1, 0)),
        (2, (0, 0, 5, 0, 0)),
        (2, (0, 3, 0, 0, 4)),
        (3, (0, 0, 0, 6, 0)),
    ),
    (
        (3, (0, 4, 3, 0, 3)),
        (4, (0, 0, 7, 0, 0)),
        (4, (2, 0, 3, 6, 0)),
        (5, (3, 0, 0, 7, 0)),
    ),
)
NOBLE_TEMPLATES = ((4, 0, 4, 0, 0), (3, 3, 0, 3, 0))


def rotate(cost, offset):
    return cost[-offset:] + cost[:-offset] if offset else cost
