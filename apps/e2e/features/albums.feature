Feature: Albums
  Create, add a Photo, count survives reload. Opening an Album shows
  its Photos. Long-press on the Album page unmembers; the Photo stays
  in the library.

  Scenario: Albums tab explains when there are none
    Given I am signed in
    When I open the "Albums" tab
    Then I should see the heading "Albums"
    And I should see the empty albums list

  Scenario: An album is deleted by selecting it in the overview
    Given I am signed in
    When I create an album named "Holiday"
    And I delete the album "Holiday" from the overview
    Then I should not see the album "Holiday"
    And I should see the empty albums list

  Scenario: Album count persists after reload
    Given I am signed in
    When I create an album named "Holiday"
    And I open the "Memories" tab
    And I open the photo from "Monday, 31 August 2026"
    And I add the viewer photo to album "Holiday"
    And I close the photo viewer
    Then the album "Holiday" should have 1 photos
    When I reload the page
    And I open the "Albums" tab
    Then the album "Holiday" should have 1 photos

  Scenario: Opening an album shows its photos
    Given I am signed in
    When I create an album named "Holiday"
    And I open the "Memories" tab
    And I open the photo from "Monday, 31 August 2026"
    And I add the viewer photo to album "Holiday"
    And I close the photo viewer
    And I open the album named "Holiday"
    Then I should see the photo from "Monday, 31 August 2026" on the album page
    And compact thumbnails should use the size for this viewport

  Scenario: New album focuses the name field
    Given I am signed in
    When I open the "Albums" tab
    Then I should see the heading "Albums"
    When I start a new album
    Then the album name field is focused

  Scenario: Long-press on the album page removes the photo from the album
    Given I am signed in
    When I create an album named "Holiday"
    And I open the "Memories" tab
    And I open the photo from "Monday, 31 August 2026"
    And I add the viewer photo to album "Holiday"
    And I close the photo viewer
    And I open the album named "Holiday"
    And I long-press the photo from "Monday, 31 August 2026"
    Then the photo actions menu is visible
    And the actions menu offers to remove from this album
    When I remove the photo from this album
    Then the album "Holiday" should have 0 photos
    When I open the "Memories" tab
    Then I should see a memory from "Monday, 31 August 2026"
