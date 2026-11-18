Feature: Library navigation
  Side nav on wide viewports, bottom bar on narrow. Re-opening Albums
  leaves an Album page. Today jumps to the newest Timeline Group.

  Scenario: Navigation matches the viewport
    Given I am signed in
    Then the main navigation should match this viewport

  Scenario: Re-tapping Albums leaves the album page
    Given I am signed in
    When I create an album named "Trip"
    And I open the album named "Trip"
    Then I should see the heading "Trip"
    When I open the "Albums" tab
    Then I should see the heading "Albums"
    And I should not see the album page

  Scenario: Today returns to the newest memories
    Given I am signed in
    When I group memories by "Week"
    And I scroll until I see the memory from "Wednesday, 15 March 2023"
    And I go back to today
    Then the current period should be "31 Aug – 6 Sep 2026"
