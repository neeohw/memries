Feature: Multi-select
  Hovering a Photo offers a checkbox. A selection replaces the header with a
  toolbar that favorites the whole selection or files it in an Album. Escape
  clears it.

  Scenario: Selecting a photo swaps the header for the selection toolbar
    Given I am signed in
    When I select the photo from "Monday, 31 August 2026"
    Then the selection toolbar should show 1 selected
    And the granularity selector should be hidden

  Scenario: Escape clears the selection
    Given I am signed in
    When I select the photo from "Monday, 31 August 2026"
    Then the selection toolbar should show 1 selected
    When I press Escape
    Then the selection toolbar should be gone
    And the granularity selector should be visible

  Scenario: A selection can be favorited in one action
    Given I am signed in
    When I select the photo from "Monday, 31 August 2026"
    And I select the photo from "Wednesday, 26 August 2026"
    Then the selection toolbar should show 2 selected
    When I favorite the selection
    Then the selection toolbar should be gone
    And the photo from "Monday, 31 August 2026" should be a favorite
    And the photo from "Wednesday, 26 August 2026" should be a favorite

  Scenario: A selection can be added to an album in one action
    Given I am signed in
    When I create an album named "Holiday"
    And I open the "Memories" tab
    And I select the photo from "Monday, 31 August 2026"
    And I select the photo from "Wednesday, 26 August 2026"
    And I add the selection to album "Holiday"
    Then the album "Holiday" should have 2 photos
