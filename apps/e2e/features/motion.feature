Feature: Motion
  Open, close, granularity, and scroll move by default. Reduced motion
  makes them instant.

  Scenario: Viewer opens from the photo card
    Given I am signed in
    When I open the photo from "Monday, 31 August 2026"
    Then the photo viewer opened from a photo card

  Scenario: Viewer closes back to the photo card
    Given I am signed in
    When I open the photo from "Monday, 31 August 2026"
    And I close the photo viewer
    Then the photo from "Monday, 31 August 2026" is focused

  Scenario: Granularity change keeps the scroll anchor
    Given I am signed in
    When I group memories by "Week"
    And I scroll until I see the memory from "Wednesday, 15 March 2023"
    And I group memories by "Month"
    Then I should see the period heading "March 2023"

  Scenario: Today control appears after scrolling
    Given I am signed in
    When I group memories by "Week"
    And I scroll until I see the memory from "Wednesday, 15 March 2023"
    Then I should see the Today control

  Scenario: Reduced motion skips motion classes
    Given I prefer reduced motion
    And I am signed in
    When I group memories by "Week"
    Then the timeline should skip motion
    When I open the photo from "Monday, 31 August 2026"
    Then the photo viewer should skip motion
